//! macOS AppKit glue: a custom `CAOpenGLLayer` subclass (`MpvOGLLayer`)
//! hosts libmpv's OpenGL renderer. The layer is the backing layer of a
//! plain `NSView`, added as a sibling of the WKWebView **below** it
//! (`NSWindowBelow`). With the webview transparent and the body CSS bg
//! transparent, HTML controls render naturally on top of the video — no
//! reserved-strip / mpv-shrink dance.
//!
//! Why `CAOpenGLLayer` and not `NSOpenGLView`: `NSOpenGLView`'s legacy
//! `NSOpenGLSurface` does not reliably composite under a layer-backed
//! sibling on modern macOS, even with `setWantsLayer:true` — the symptom
//! is "mpv renders somewhere, but the user never sees it" (solid black
//! while playback ticks). `CAOpenGLLayer` owns its CGL context and IS
//! the layer, so its contents are a first-class CALayer member of the
//! compositor stack. Same pattern as IINA's `MPVOGLLayer`.
//!
//! `CAOpenGLLayer` + CGL are deprecated as of macOS 10.14 (Apple's
//! replacement is `CAMetalLayer`), but still work on macOS 13+ (our
//! minimum target). A future Metal migration would swap the render API.

#![allow(deprecated)]

use std::cell::Cell;
use std::ffi::{c_char, c_void, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadOnly};
use objc2_app_kit::{NSView, NSWindow};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
use objc2_quartz_core::{kCAGravityResizeAspect, CALayer, CAOpenGLLayer};

use crate::models::{Bounds, StatePayload};

// Property names we observe. Pulled into constants because we cross-
// reference them in both the observer setup and the event dispatch
// match below — typoing one was easy when they were inline strings.
const PROP_TIME_POS: &str = "time-pos";
const PROP_DURATION: &str = "duration";
const PROP_PAUSE: &str = "pause";
const PROP_EOF_REACHED: &str = "eof-reached";
const PROP_TRACK_LIST: &str = "track-list";
const PROP_CACHE_STATE: &str = "demuxer-cache-state";
const PROP_VOLUME: &str = "volume";
const PROP_MUTE: &str = "mute";

// Safety-net timeout for the event-loop park. The loop normally sleeps
// until mpv's wakeup callback signals a new event (idle CPU ≈ 0). This
// bounded wait just guarantees we re-check periodically even in the
// (shouldn't-happen) case of a missed wakeup. NOT a polling interval —
// during playback the callback fires far faster than this.
const EVENT_PARK_TIMEOUT_MS: u64 = 1000;

// --- render-path instrumentation -------------------------------------
//
// The JS debug dump can't see native render cost: `mpv_render_context_render`
// runs on CA's render thread (async layer), not as a JS "long task", so
// the browser's Long Tasks API never attributes it — a 1700ms rAF stall
// with "0 long tasks" in the dump is this work hiding. We count it here
// instead. The ms figures show per-draw GL cost. (`UPDATE_CB_FIRES` is
// only meaningful in sync mode, where the update callback is installed;
// in async mode it stays 0 — see LAYER_ASYNCHRONOUS.)
static UPDATE_CB_FIRES: AtomicU64 = AtomicU64::new(0);
static RENDER_COUNT: AtomicU64 = AtomicU64::new(0);
static RENDER_NS_TOTAL: AtomicU64 = AtomicU64::new(0);
static RENDER_NS_MAX: AtomicU64 = AtomicU64::new(0);

// Render-driving mode for the layer.
//
// `true` (async): CA runs a display-link timer that polls
// `canDrawInCGLContext:` at the refresh rate on ITS OWN thread and draws
// when our gate (mpv's new-frame flag) says yes. This keeps
// `mpv_render_context_render` off the main thread entirely.
//
// In this mode we do NOT install mpv's render update callback. The
// callback exists to wake a foreign event loop when a frame is ready —
// but CA is already polling for us, so a callback would only add ~60
// `run_on_main_thread` hops/sec during playback (each just calling
// `setNeedsDisplay`), which is pure WKWebView-compositor noise. Dropping
// it removes that load and the whole `redraw_pending`-flood class of
// problem (the callback never fires, so there's nothing to coalesce).
//
// `false` (sync): draws run on the main thread and only when something
// invalidates the layer, so we MUST install the update callback to turn
// "mpv has a new frame" into a `setNeedsDisplay`. Kept as a fallback
// switch in case a future macOS changes async-layer polling behavior.
const LAYER_ASYNCHRONOUS: bool = true;

// --- libmpv init + event loop ----------------------------------------

pub(crate) fn create_mpv() -> Result<libmpv2::Mpv, libmpv2::Error> {
    use libmpv2::Mpv;

    // Force the libmpv video output BEFORE mpv_initialize() runs (which
    // happens at the end of this closure). If we don't, mpv defaults to
    // vo=gpu and spawns its own NSWindow during init — too late for the
    // render context we create afterwards to take over. Setting
    // vo=libmpv tells mpv to expect an external host (us) to drive
    // rendering via mpv_render_context_create.
    Mpv::with_initializer(|init| {
        init.set_property("config", false)?;
        init.set_property("load-scripts", false)?;
        init.set_property("ytdl", false)?;
        init.set_property("access-references", false)?;
        init.set_property("vo", "libmpv")?;
        init.set_property("keepaspect", true)?;
        init.set_property("hwdec", "auto-safe")?;
        init.set_property("cache", "yes")?;
        init.set_property("demuxer-max-bytes", 256i64 * 1024 * 1024)?;
        init.set_property("demuxer-max-back-bytes", 64i64 * 1024 * 1024)?;
        // keep-open=yes: after the file plays to completion, mpv stays
        // paused on the last frame instead of going idle, so a seek
        // back works without re-loading.
        init.set_property("keep-open", "yes")?;
        // video-timing-offset=0: mpv normally schedules each frame to
        // be rendered slightly BEFORE its wall-clock display time and
        // makes mpv_render_context_render() block until then. Setting
        // this to 0 disables that internal timing wait, so our render
        // call returns as soon as the frame is composited. Necessary
        // for files without audio (video pacing depends entirely on
        // this signal) and dramatically reduces main-thread time.
        init.set_property("video-timing-offset", 0.0)?;
        init.set_property("osc", false)?;
        init.set_property("input-default-bindings", false)?;
        init.set_property("input-vo-keyboard", false)?;
        Ok(())
    })
}

/// Read a Flag-typed property as bool. We deliberately do NOT use
/// `mpv.get_property::<bool>(...)`: libmpv2 6.0.0's `GetData for bool`
/// uses the default 1-byte allocation but tells mpv to write Flag
/// (`int` == 4 bytes), causing a 3-byte stack overflow per call. We
/// read as `String` ("yes"/"no") instead, which is sized correctly
/// because libmpv2's String impl allocates a pointer.
fn read_flag(mpv: &libmpv2::Mpv, name: &str) -> Option<bool> {
    let s = mpv.get_property::<String>(name).ok()?;
    Some(s == "yes" || s == "true")
}

/// Parking primitive for the event loop. mpv's wakeup callback (which
/// fires on an arbitrary mpv-internal thread whenever a new event is
/// queued) sets `ready` and notifies; the event thread blocks on the
/// condvar until then, so idle CPU is ~0 instead of the old 125Hz poll.
struct EventWaker {
    ready: Mutex<bool>,
    cv: parking_lot::Condvar,
}

/// C-ABI wakeup callback handed to `mpv_set_wakeup_callback`. Must stay
/// lightweight and must NOT call back into the mpv API (mpv contract) —
/// we only flip a flag and notify. `ctx` is a leaked `Arc<EventWaker>`
/// pointer that lives for the app's lifetime.
unsafe extern "C" fn event_wakeup_cb(ctx: *mut c_void) {
    if ctx.is_null() {
        return;
    }
    let waker = &*(ctx as *const EventWaker);
    let mut ready = waker.ready.lock();
    *ready = true;
    waker.cv.notify_one();
}

pub(crate) fn start_event_loop(app: &tauri::AppHandle, inner: Arc<Mutex<Option<libmpv2::Mpv>>>) {
    use libmpv2::{events::Event, Format};
    use tauri::Emitter;

    let app = app.clone();
    let waker = Arc::new(EventWaker {
        ready: Mutex::new(false),
        cv: parking_lot::Condvar::new(),
    });

    std::thread::spawn(move || {
        {
            let g = inner.lock();
            let Some(mpv) = g.as_ref() else { return };
            let _ = mpv.observe_property(PROP_TIME_POS, Format::Double, 0);
            let _ = mpv.observe_property(PROP_DURATION, Format::Double, 0);
            let _ = mpv.observe_property(PROP_PAUSE, Format::Flag, 0);
            let _ = mpv.observe_property(PROP_EOF_REACHED, Format::Flag, 0);
            let _ = mpv.observe_property(PROP_VOLUME, Format::Double, 0);
            let _ = mpv.observe_property(PROP_MUTE, Format::Flag, 0);
            let _ = mpv.observe_property(PROP_TRACK_LIST, Format::String, 0);
            let _ = mpv.observe_property(PROP_CACHE_STATE, Format::String, 0);

            // Register the wakeup callback so we can block instead of poll.
            // Leak one Arc ref as the callback ctx (app-lifetime, same as
            // the mpv instance / render context — none are torn down).
            let ctx = Arc::into_raw(Arc::clone(&waker)) as *mut c_void;
            unsafe {
                libmpv2_sys::mpv_set_wakeup_callback(mpv.ctx.as_ptr(), Some(event_wakeup_cb), ctx);
            }
        }

        // Latest known state, mutated field-by-field as property-change
        // events arrive. Reading only the ONE property that changed (vs.
        // re-reading all six every event) is the perf win here; the
        // emitted snapshot is equivalent because mpv delivers a change
        // event per property and the cache stays current between them.
        let mut cached = StatePayload {
            time_pos: None,
            duration: None,
            paused: None,
            volume: None,
            muted: None,
            eof: false,
        };

        // Per dequeued event: what to do after releasing the lock.
        enum Step {
            Idle,      // queue drained — go park
            EmitState, // a state field changed — emit the snapshot
            Tracks(String),
            Buffer(String),
            Eof(String),
            Shutdown,
            Other, // non-emitting event — keep draining
        }

        'outer: loop {
            // Drain everything currently queued without sleeping.
            loop {
                let step = {
                    let mut g = inner.lock();
                    let Some(mpv) = g.as_mut() else { break 'outer };
                    match mpv.wait_event(0.0) {
                        None => Step::Idle,
                        Some(Err(_)) => Step::Other,
                        Some(Ok(evt)) => match evt {
                            Event::PropertyChange { name, .. } => match name {
                                PROP_TIME_POS => {
                                    cached.time_pos = mpv.get_property::<f64>(PROP_TIME_POS).ok();
                                    Step::EmitState
                                }
                                PROP_DURATION => {
                                    cached.duration = mpv.get_property::<f64>(PROP_DURATION).ok();
                                    Step::EmitState
                                }
                                // NB: read_flag (not get_property::<bool>) —
                                // see comment above the helper.
                                PROP_PAUSE => {
                                    cached.paused = read_flag(mpv, PROP_PAUSE);
                                    Step::EmitState
                                }
                                PROP_VOLUME => {
                                    cached.volume = mpv.get_property::<f64>(PROP_VOLUME).ok();
                                    Step::EmitState
                                }
                                PROP_MUTE => {
                                    cached.muted = read_flag(mpv, PROP_MUTE);
                                    Step::EmitState
                                }
                                PROP_EOF_REACHED => {
                                    cached.eof = read_flag(mpv, PROP_EOF_REACHED).unwrap_or(false);
                                    Step::EmitState
                                }
                                PROP_TRACK_LIST => {
                                    match mpv.get_property::<String>(PROP_TRACK_LIST).ok() {
                                        Some(t) => Step::Tracks(t),
                                        None => Step::Other,
                                    }
                                }
                                PROP_CACHE_STATE => {
                                    match mpv.get_property::<String>(PROP_CACHE_STATE).ok() {
                                        Some(b) => Step::Buffer(b),
                                        None => Step::Other,
                                    }
                                }
                                _ => Step::Other,
                            },
                            Event::EndFile(reason) => Step::Eof(format!("{reason:?}")),
                            Event::Shutdown => Step::Shutdown,
                            _ => Step::Other,
                        },
                    }
                };

                match step {
                    Step::Idle => break, // inner drain loop; go park below
                    Step::EmitState => {
                        let _ = app.emit("mpv:state", cached.clone());
                    }
                    Step::Tracks(t) => {
                        let _ = app.emit("mpv:tracks", t);
                    }
                    Step::Buffer(b) => {
                        let _ = app.emit("mpv:buffer", b);
                    }
                    Step::Eof(reason) => {
                        let _ = app.emit("mpv:eof", reason);
                    }
                    Step::Shutdown => break 'outer,
                    Step::Other => {} // keep draining
                }
            }

            // Park until the wakeup callback signals a new event. The
            // `ready` flag (checked under the lock) closes the lost-wakeup
            // race: if a wakeup landed between draining and parking, we
            // skip the wait. The timeout is a safety net, not a poll.
            let mut ready = waker.ready.lock();
            if !*ready {
                waker.cv.wait_for(
                    &mut ready,
                    std::time::Duration::from_millis(EVENT_PARK_TIMEOUT_MS),
                );
            }
            *ready = false;
        }
    });
}

// -- CGL FFI ------------------------------------------------------------
//
// We bypass `objc2-open-gl` to keep the dependency surface small. The
// CGL functions and `kCGLPFA*` constants below come directly from
// `<OpenGL/CGLTypes.h>` / `<OpenGL/OpenGL.h>` (deprecated but still
// linkable on macOS 13+).

#[link(name = "OpenGL", kind = "framework")]
extern "C" {
    fn CGLChoosePixelFormat(attribs: *const u32, pix: *mut *mut c_void, npix: *mut i32) -> i32;
    fn CGLReleasePixelFormat(pix: *mut c_void);
    fn CGLCreateContext(pix: *mut c_void, share: *mut c_void, ctx: *mut *mut c_void) -> i32;
    fn CGLReleaseContext(ctx: *mut c_void);
    fn CGLSetCurrentContext(ctx: *mut c_void) -> i32;
    // Minimal GL surface for the diagnostic clear at the top of each
    // frame. macOS exposes these via libGL (OpenGL.framework).
    fn glClearColor(r: f32, g: f32, b: f32, a: f32);
    fn glClear(mask: u32);
    fn glViewport(x: i32, y: i32, width: i32, height: i32);
    fn glGetIntegerv(pname: u32, params: *mut i32);
}
const GL_COLOR_BUFFER_BIT: u32 = 0x4000;
/// `GL_FRAMEBUFFER_BINDING` — query the FBO currently bound to
/// `GL_FRAMEBUFFER`. CoreAnimation binds the layer's IOSurface-backed
/// FBO before calling `drawInCGLContext:` on macOS, and that FBO is NOT
/// id 0 (modern macOS). mpv's `MPV_RENDER_PARAM_OPENGL_FBO` with `fbo=0`
/// would write to the CGL context's default framebuffer (a different
/// IOSurface), not the one CA composites — so the layer keeps showing
/// whatever the previous draw wrote and mpv's output never appears.
/// Querying + forwarding the actual binding fixes that.
const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

// CGLPixelFormatAttribute values (subset). Sourced from
// <OpenGL/CGLTypes.h>; declared inline to avoid pulling in objc2-open-gl
// just for these handful of u32 constants.
const KCGL_PFA_OPENGL_PROFILE: u32 = 99;
const KCGL_OGLP_VERSION_3_2_CORE: u32 = 0x3200;
const KCGL_PFA_ACCELERATED: u32 = 73;
const KCGL_PFA_DOUBLE_BUFFER: u32 = 5;
const KCGL_PFA_COLOR_SIZE: u32 = 8;
const KCGL_PFA_ALPHA_SIZE: u32 = 11;
const KCGL_PFA_DEPTH_SIZE: u32 = 12;
const KCGL_PFA_ALLOW_OFFLINE_RENDERERS: u32 = 96;

// -- MpvOGLLayer subclass -----------------------------------------------

/// Ivars for our `CAOpenGLLayer` subclass. `render_ctx` is a `Cell`
/// because it's touched only from CA's draw path — `canDrawInCGLContext:`
/// and `drawInCGLContext:` (+ the lazy init it calls). With
/// `asynchronous = YES` those run on CA's dedicated render thread rather
/// than main, but CA serializes them for a given layer, so access stays
/// single-threaded and lock-free. Nothing else reads/writes the Cell.
/// The `Mutex<Option<...>>` fields ARE cross-thread (set once on main
/// after layer creation, read on the render thread), so they keep a lock.
pub struct MpvLayerIvars {
    mpv_inner: Mutex<Option<Arc<Mutex<Option<libmpv2::Mpv>>>>>,
    app: Mutex<Option<tauri::AppHandle>>,
    /// `mpv_render_context` pointer. Created lazily on the first
    /// `drawInCGLContext:` callback because that's the only time we hold
    /// a current CGL context on the calling thread, which
    /// `mpv_render_context_create` requires (it calls `glGetString`
    /// synchronously during init).
    render_ctx: Cell<*mut libmpv2_sys::mpv_render_context>,
    /// Guard so we only install the mpv→layer update callback once.
    update_cb_installed: AtomicBool,
}

define_class!(
    // SAFETY: CAOpenGLLayer has no documented subclassing restrictions
    // beyond the standard "draw methods may be called from CA's thread
    // when async=YES" caveat. We run with `setAsynchronous(true)` (see
    // LAYER_ASYNCHRONOUS), so `canDrawInCGLContext:` / `drawInCGLContext:`
    // (and the lazy render-ctx init they trigger) execute on CA's own
    // render thread — NOT the main thread. The `Cell`-based ivars are
    // sound because CA serializes those callbacks per layer, so the draw
    // path is single-threaded; nothing else touches the `Cell`. (The
    // `Mutex` ivars, by contrast, ARE cross-thread: written once on main
    // after creation, read on the render thread.)
    #[unsafe(super(CAOpenGLLayer))]
    #[name = "MpvOGLLayer"]
    #[ivars = MpvLayerIvars]
    pub struct MpvOGLLayer;

    impl MpvOGLLayer {
        /// Return a CGL pixel format suitable for libmpv: GL 3.2 core,
        /// accelerated, double-buffered, 24-bit colour + 8-bit alpha.
        /// Caller-retains (the "copy" naming convention).
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> *mut c_void {
            let attrs: [u32; 12] = [
                KCGL_PFA_OPENGL_PROFILE, KCGL_OGLP_VERSION_3_2_CORE,
                KCGL_PFA_ACCELERATED, 0,
                KCGL_PFA_DOUBLE_BUFFER, 0,
                KCGL_PFA_COLOR_SIZE, 24,
                KCGL_PFA_ALPHA_SIZE, 8,
                KCGL_PFA_DEPTH_SIZE, 0,
            ];
            // Append allow-offline-renderers + 0 terminator manually so
            // the array size stays a known constant.
            let mut attrs_full: [u32; 14] = [0; 14];
            attrs_full[..12].copy_from_slice(&attrs);
            attrs_full[12] = KCGL_PFA_ALLOW_OFFLINE_RENDERERS;
            attrs_full[13] = 0;
            let mut pf: *mut c_void = std::ptr::null_mut();
            let mut npix: i32 = 0;
            unsafe {
                let err = CGLChoosePixelFormat(attrs_full.as_ptr(), &mut pf, &mut npix);
                if err != 0 || pf.is_null() {
                    eprintln!("[mpv-layer] CGLChoosePixelFormat failed: err={err}");
                }
            }
            pf
        }

        #[unsafe(method(releaseCGLPixelFormat:))]
        fn release_pixel_format(&self, pf: *mut c_void) {
            if !pf.is_null() {
                unsafe { CGLReleasePixelFormat(pf) };
            }
        }

        /// Build the CGL context CA will hand to our draw method on every
        /// redraw. Caller-retains.
        #[unsafe(method(copyCGLContextForPixelFormat:))]
        fn copy_context(&self, pf: *mut c_void) -> *mut c_void {
            let mut ctx: *mut c_void = std::ptr::null_mut();
            unsafe {
                let err = CGLCreateContext(pf, std::ptr::null_mut(), &mut ctx);
                if err != 0 || ctx.is_null() {
                    eprintln!("[mpv-layer] CGLCreateContext failed: err={err}");
                }
            }
            ctx
        }

        #[unsafe(method(releaseCGLContext:))]
        fn release_context(&self, ctx: *mut c_void) {
            if !ctx.is_null() {
                unsafe { CGLReleaseContext(ctx) };
            }
        }

        /// `canDrawInCGLContext:` is CA's gate before invoking
        /// `drawInCGLContext:`. We always allow it — mpv tells us when a
        /// frame is ready via the update callback, but returning `true`
        /// here also lets the layer redraw on resize / contentsScale
        /// change, which we want.
        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn can_draw(
            &self,
            _ctx: *mut c_void,
            _pf: *mut c_void,
            _t: f64,
            _ts: *const c_void,
        ) -> bool {
            // With `asynchronous = YES`, CA polls this at the display refresh
            // rate on its own thread. Returning `true` unconditionally would
            // re-render a static (e.g. paused) frame 60x/sec, so gate on
            // mpv's own "new frame ready?" flag. Before the render context
            // exists (null), allow the draw so the lazy init in `draw_inner`
            // runs. Single tail expression: the objc2 method macro coerces a
            // tail `bool` into `BOOL` but not an explicit `return`.
            let rctx = self.ivars().render_ctx.get();
            rctx.is_null() || {
                let flags = unsafe { libmpv2_sys::mpv_render_context_update(rctx) };
                flags & (libmpv2_sys::mpv_render_update_flag_MPV_RENDER_UPDATE_FRAME as u64) != 0
            }
        }

        /// The hot path. Called by CA whenever the layer needs to redraw.
        /// Lazy-creates the `mpv_render_context` on the first invocation
        /// (CGL context is current at this point, satisfying
        /// `mpv_render_context_create`'s requirement), then asks mpv to
        /// render into the layer's default framebuffer.
        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn draw_in_cgl(
            &self,
            ctx: *mut c_void,
            _pf: *mut c_void,
            _t: f64,
            _ts: *const c_void,
        ) {
            unsafe {
                CGLSetCurrentContext(ctx);
                self.draw_inner(ctx);
            }
        }
    }
);

impl MpvOGLLayer {
    pub fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(MpvLayerIvars {
            mpv_inner: Mutex::new(None),
            app: Mutex::new(None),
            render_ctx: Cell::new(std::ptr::null_mut()),
            update_cb_installed: AtomicBool::new(false),
        });
        // SAFETY: `init` on NSObject is always safe to send to a
        // freshly-allocated instance.
        unsafe { msg_send![super(this), init] }
    }

    /// Stash the mpv handle + app handle so the layer can build its
    /// render context on the next draw. Safe to call once, after attach
    /// has populated the inner `Mpv`.
    pub fn attach_mpv(&self, mpv_inner: Arc<Mutex<Option<libmpv2::Mpv>>>, app: tauri::AppHandle) {
        *self.ivars().mpv_inner.lock() = Some(mpv_inner);
        *self.ivars().app.lock() = Some(app);
    }

    /// Inner draw routine. CGL context is already current on entry.
    unsafe fn draw_inner(&self, _ctx: *mut c_void) {
        // Layer pixel size: bounds (points) * contentsScale. CALayer
        // derefs through CAOpenGLLayer's superclass chain.
        let layer: &CALayer = self;
        let bounds = layer.bounds();
        let scale = layer.contentsScale();
        let w = (bounds.size.width * scale) as i32;
        let h = (bounds.size.height * scale) as i32;

        // Clear to opaque black before mpv renders. This gives us a
        // known-good background so any 1-px alignment artifact at the
        // FBO edges shows as black (invisible) rather than
        // GL-uninitialized memory (often a green/turquoise streak).
        if w > 0 && h > 0 {
            glViewport(0, 0, w, h);
            glClearColor(0.0, 0.0, 0.0, 1.0);
            glClear(GL_COLOR_BUFFER_BIT);
        }

        // Lazy-init the mpv render context the first time CA invokes our
        // draw. At this point the CGL context is current on the calling
        // thread, which `mpv_render_context_create` needs (it calls
        // `glGetString` during init).
        if self.ivars().render_ctx.get().is_null() {
            if let Err(e) = self.lazy_init_render_ctx() {
                eprintln!("[mpv-layer] lazy init failed: {e}");
                return;
            }
        }
        let rctx = self.ivars().render_ctx.get();
        if rctx.is_null() {
            return;
        }

        if w <= 0 || h <= 0 {
            // Layer hasn't been resized yet — bail; the next bounds-sync
            // will trigger a redraw.
            return;
        }

        // Query the framebuffer CoreAnimation has bound for this draw —
        // see comment on `GL_FRAMEBUFFER_BINDING` above. Hardcoding
        // `fbo=0` writes to the wrong target and leaves the clear
        // permanently visible.
        let mut current_fbo: i32 = 0;
        glGetIntegerv(GL_FRAMEBUFFER_BINDING, &mut current_fbo);

        // GL_RGBA8 = 0x8058. With `internal_format=0`, mpv guesses a
        // format and on macOS picks one that's off-by-one for the bottom
        // row of pixels — produces the green/turquoise streak at the
        // bottom of the video. Specifying the explicit RGBA8 format
        // matches what CoreAnimation backs the layer's IOSurface with
        // and eliminates the artifact.
        const GL_RGBA8: i32 = 0x8058;
        let mut fbo = libmpv2_sys::mpv_opengl_fbo {
            fbo: current_fbo,
            w,
            h,
            internal_format: GL_RGBA8,
        };
        // FLIP_Y=1: mpv's image origin is top-left, OpenGL's is
        // bottom-left. Without this, video is upside-down.
        let mut flip: i32 = 1;
        // BLOCK_FOR_TARGET_TIME=0: don't let mpv stall this draw waiting
        // for the frame's wall-clock display time. mpv also sees
        // `video-timing-offset=0` at init, so the two together produce
        // no internal pacing waits.
        let mut block_for_target_time: i32 = 0;
        let mut params: [libmpv2_sys::mpv_render_param; 4] = [
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO,
                data: &mut fbo as *mut _ as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y,
                data: &mut flip as *mut _ as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME,
                data: &mut block_for_target_time as *mut _ as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: 0,
                data: std::ptr::null_mut(),
            },
        ];
        let t0 = std::time::Instant::now();
        libmpv2_sys::mpv_render_context_render(rctx, params.as_mut_ptr());
        let ns = t0.elapsed().as_nanos() as u64;
        // CA handles the back-to-front swap after our draw returns; do
        // NOT call CGLFlushDrawable ourselves.

        // Aggregate per-draw cost and dump a window summary so the native
        // render time can be correlated against the JS fps-hitch timeline.
        let n = RENDER_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
        RENDER_NS_TOTAL.fetch_add(ns, Ordering::Relaxed);
        RENDER_NS_MAX.fetch_max(ns, Ordering::Relaxed);
        if n % 120 == 0 {
            let total = RENDER_NS_TOTAL.swap(0, Ordering::Relaxed);
            let max = RENDER_NS_MAX.swap(0, Ordering::Relaxed);
            let fires = UPDATE_CB_FIRES.swap(0, Ordering::Relaxed);
            let avg_ms = (total as f64 / 120.0) / 1.0e6;
            let max_ms = max as f64 / 1.0e6;
            // Only surface pathological windows so steady 60fps playback
            // doesn't spam the log. fires > 240 over 120 draws == mpv's
            // update callback firing >2x per draw (the drag flood).
            if max_ms > 16.0 || fires > 240 {
                eprintln!(
                    "[mpv-layer] SLOW render window: 120 draws, mpv-update fires={fires}, avg={avg_ms:.1}ms, max={max_ms:.1}ms"
                );
            }
        }
    }

    unsafe fn lazy_init_render_ctx(&self) -> Result<(), String> {
        let mpv_guard = self.ivars().mpv_inner.lock();
        let mpv_arc = mpv_guard
            .as_ref()
            .ok_or_else(|| "mpv handle not yet attached to layer".to_string())?
            .clone();
        drop(mpv_guard); // release before locking inner

        let inner_guard = mpv_arc.lock();
        let mpv = inner_guard
            .as_ref()
            .ok_or_else(|| "mpv not initialized".to_string())?;
        let mpv_handle = mpv.ctx.as_ptr();

        let mut init_params = libmpv2_sys::mpv_opengl_init_params {
            get_proc_address: Some(gl_get_proc_address_raw),
            get_proc_address_ctx: std::ptr::null_mut(),
        };
        let api_type_str = libmpv2_sys::MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *mut c_void;
        let params: [libmpv2_sys::mpv_render_param; 3] = [
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                data: api_type_str,
            },
            libmpv2_sys::mpv_render_param {
                type_: libmpv2_sys::mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                data: &mut init_params as *mut _ as *mut c_void,
            },
            libmpv2_sys::mpv_render_param {
                type_: 0,
                data: std::ptr::null_mut(),
            },
        ];

        let mut out_ctx: *mut libmpv2_sys::mpv_render_context = std::ptr::null_mut();
        let err = libmpv2_sys::mpv_render_context_create(
            &mut out_ctx,
            mpv_handle,
            params.as_ptr() as *mut _,
        );
        if err < 0 || out_ctx.is_null() {
            return Err(format!("mpv_render_context_create failed: code={err}"));
        }
        self.ivars().render_ctx.set(out_ctx);
        eprintln!(
            "[mpv-layer] render context created (ctx=0x{:x})",
            out_ctx as usize
        );

        // Install the update callback exactly once — but ONLY in sync
        // mode. In async mode CA polls `canDrawInCGLContext:` for us, so
        // the callback would just flood the main thread with redundant
        // `setNeedsDisplay` hops (see LAYER_ASYNCHRONOUS).
        if !LAYER_ASYNCHRONOUS
            && !self
                .ivars()
                .update_cb_installed
                .swap(true, Ordering::AcqRel)
        {
            let app = self
                .ivars()
                .app
                .lock()
                .clone()
                .ok_or_else(|| "app handle not attached".to_string())?;
            let self_ptr: usize = self as *const Self as usize;
            install_update_callback_for_layer(out_ctx, self_ptr, app);
        }
        Ok(())
    }
}

/// Boxed context for the mpv update callback. The render thread holds a
/// raw pointer; we hop to main before touching the layer.
struct LayerUpdateCtx {
    layer_ptr: usize,
    app: tauri::AppHandle,
    /// Bounds in-flight main-thread redraw hops to one. mpv's render
    /// thread can fire the update callback faster than the main thread
    /// drains it — dragging a `sub-*` slider on a paused frame triggers
    /// hundreds of fires/sec. `setNeedsDisplay` already coalesces the
    /// DRAWS, but each fire still posts its own `run_on_main_thread`
    /// closure, and that flood of run-loop events is what starves the
    /// WKWebView compositor (rAF stalls for seconds, with no JS long
    /// task because the cost is native). One pending hop collapses an
    /// arbitrary burst into a single draw.
    redraw_pending: AtomicBool,
}

fn install_update_callback_for_layer(
    render_ctx: *mut libmpv2_sys::mpv_render_context,
    layer_ptr: usize,
    app: tauri::AppHandle,
) {
    let boxed = Box::new(LayerUpdateCtx {
        layer_ptr,
        app,
        redraw_pending: AtomicBool::new(false),
    });
    let raw_box = Box::into_raw(boxed);

    unsafe extern "C" fn update_cb(ctx: *mut c_void) {
        if ctx.is_null() {
            return;
        }
        let cb = &*(ctx as *const LayerUpdateCtx);
        UPDATE_CB_FIRES.fetch_add(1, Ordering::Relaxed);
        // Drop this fire if a redraw hop is already queued — see the
        // `redraw_pending` field comment for why bounding the dispatch
        // (not just the draw) is what fixes the compositor starvation.
        if cb.redraw_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let ctx_addr = ctx as usize;
        let layer_ptr = cb.layer_ptr;
        if cb
            .app
            .run_on_main_thread(move || unsafe {
                // Clear before drawing so an update arriving mid-draw queues
                // a fresh hop — we coalesce bursts without ever dropping the
                // latest frame.
                let cb = &*(ctx_addr as *const LayerUpdateCtx);
                cb.redraw_pending.store(false, Ordering::Release);
                let layer: &CALayer = &*(layer_ptr as *const CALayer);
                layer.setNeedsDisplay();
            })
            .is_err()
        {
            // The closure will never run (run loop tearing down, etc.), so
            // reset the flag ourselves — otherwise `redraw_pending` latches
            // `true` forever and every future frame is silently dropped
            // (the video freezes and never recovers).
            cb.redraw_pending.store(false, Ordering::Release);
        }
    }

    unsafe {
        libmpv2_sys::mpv_render_context_set_update_callback(
            render_ctx,
            Some(update_cb),
            raw_box as *mut c_void,
        );
    }
}

// -- Public install / bounds / attach API -------------------------------

/// Create the host `NSView` + `MpvOGLLayer`, add the view as a
/// `NSWindowBelow` sibling of the WKWebView. Returns `(view_ptr,
/// layer_ptr)` as usize so callers don't have to juggle `Send` on raw
/// pointers.
pub(crate) async fn install_host_view(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(usize, usize), String> {
    let ns_window_ptr = window.ns_window().map_err(|e| format!("ns_window: {e}"))? as usize;
    if ns_window_ptr == 0 {
        return Err("ns_window null".to_string());
    }
    run_on_main(app, move || unsafe {
        install_host_view_main(ns_window_ptr)
    })
    .await
}

pub(crate) async fn set_view_bounds(
    app: &tauri::AppHandle,
    view_ptr: usize,
    layer_ptr: Option<usize>,
    bounds: Bounds,
) -> Result<(), String> {
    run_on_main(app, move || unsafe {
        set_view_bounds_main(view_ptr, layer_ptr, bounds);
        Ok(())
    })
    .await
}

/// Hand the mpv inner handle + a clonable Tauri AppHandle to the layer
/// so it can build its `mpv_render_context` on first draw and dispatch
/// update-callback redraws back to the main thread.
pub(crate) fn attach_mpv_to_layer(
    app: &tauri::AppHandle,
    layer_ptr: usize,
    mpv_inner: Arc<Mutex<Option<libmpv2::Mpv>>>,
) {
    if layer_ptr == 0 {
        return;
    }
    // SAFETY: layer_ptr was returned by `Retained::into_raw` in
    // `install_host_view_main`; we only borrow it here.
    unsafe {
        let layer = &*(layer_ptr as *const MpvOGLLayer);
        layer.attach_mpv(mpv_inner, app.clone());
    }
}

/// Ask the layer to redraw once. Used right after attach so the layer's
/// lazy init fires without waiting for an external event.
pub(crate) async fn request_redraw(app: &tauri::AppHandle, layer_ptr: usize) {
    if layer_ptr == 0 {
        return;
    }
    let _ = run_on_main(app, move || unsafe {
        let layer = &*(layer_ptr as *const CALayer);
        layer.setNeedsDisplay();
        Ok::<(), String>(())
    })
    .await;
}

// -- Main-thread routines -----------------------------------------------

unsafe fn install_host_view_main(ns_window_ptr: usize) -> Result<(usize, usize), String> {
    let mtm = MainThreadMarker::new().ok_or_else(|| "must run on main thread".to_string())?;

    let ns_window: &NSWindow = &*(ns_window_ptr as *const NSWindow);
    let content_view = ns_window
        .contentView()
        .ok_or_else(|| "contentView nil".to_string())?;

    // Plain NSView at zero rect; React's first `set_bounds` call sizes
    // it to the placeholder div's screen rect.
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
    let view: Retained<NSView> = NSView::initWithFrame(NSView::alloc(mtm), frame);

    let layer: Retained<MpvOGLLayer> = MpvOGLLayer::new();
    // contentsScale ← window's backing scale (Retina). Update again in
    // `set_view_bounds_main` to catch display moves.
    let scale = ns_window.backingScaleFactor();
    let calayer_ref: &CALayer = &layer;
    calayer_ref.setContentsScale(scale);
    calayer_ref.setOpaque(true);
    calayer_ref.setContentsGravity(kCAGravityResizeAspect);
    // Async mode: CA invokes our draw method on its OWN render thread, so
    // `mpv_render_context_render` no longer runs on (and stalls) the main
    // thread — that was the source of the residual slider-drag hitches
    // (renders are cheap on average but spiked to ~64ms, and on the main
    // thread that starves rAF). `canDrawInCGLContext:` gates draws on mpv's
    // new-frame flag so idle/paused frames don't re-render at 60Hz. The
    // render context is still created lazily inside the first draw — safe
    // because CA makes the CGL context current before each draw regardless
    // of which thread it runs on. See LAYER_ASYNCHRONOUS for why we also
    // skip mpv's update callback in this mode.
    layer.setAsynchronous(LAYER_ASYNCHRONOUS);

    // ORDER MATTERS: `setLayer:` first, `setWantsLayer:true` second.
    // This sequence makes the view "layer-hosted" — it uses OUR layer.
    // The opposite order makes the view "layer-backed" — AppKit
    // allocates its own default CALayer and IGNORES the subsequent
    // `setLayer:` call. (Source: NSView class reference, "Managing the
    // View's Layer".)
    view.setLayer(Some(calayer_ref));
    view.setWantsLayer(true);

    // Insert UNDER the WKWebView. Combined with `"transparent": true` in
    // tauri.conf.json and a transparent body CSS bg, HTML controls
    // overlay the video naturally — Stremio/YouTube style — without any
    // reserved-strip / mpv-shrink dance.
    const NS_WINDOW_BELOW: i64 = -1;
    let view_obj: *const AnyObject = Retained::as_ptr(&view) as *const AnyObject;
    let _: () = msg_send![
        &*content_view,
        addSubview: view_obj,
        positioned: NS_WINDOW_BELOW,
        relativeTo: std::ptr::null::<AnyObject>(),
    ];

    // Leak the Retaineds: the contentView retains the NSView, which
    // retains its layer — both stay alive for the app lifetime. We hand
    // back raw pointers so the Rust side can address them across threads.
    let layer_raw: *mut MpvOGLLayer = Retained::into_raw(layer);
    let view_raw: *mut NSView = Retained::into_raw(view);
    Ok((view_raw as usize, layer_raw as usize))
}

unsafe fn set_view_bounds_main(view_ptr: usize, layer_ptr: Option<usize>, bounds: Bounds) {
    if view_ptr == 0 {
        return;
    }
    let view: &NSView = &*(view_ptr as *const NSView);
    let superview = view.superview();
    let parent_height = superview
        .as_ref()
        .map(|s| s.frame().size.height)
        .unwrap_or(0.0);

    // KEY: WKWebView and many wry-wrapper views are `isFlipped = YES` —
    // their coordinate system is top-origin (matches web CSS px). A
    // default `NSView` (true `NSWindow.contentView`) is `isFlipped = NO`
    // (bottom-origin AppKit default). Tauri's wry on macOS sets the
    // WKWebView as the window's contentView, so when we ask
    // `ns_window.contentView()` and `addSubview` to it, our superview is
    // FLIPPED. In that case we use `bounds.y` directly; no flip math.
    let superview_flipped = superview.as_ref().map(|s| s.isFlipped()).unwrap_or(false);
    let frame_y = if superview_flipped {
        bounds.y
    } else {
        parent_height - bounds.y - bounds.h
    };
    let view_frame = NSRect::new(
        NSPoint::new(bounds.x, frame_y),
        NSSize::new(bounds.w, bounds.h),
    );
    view.setFrame(view_frame);

    // CRITICAL: in layer-hosted mode (where we provided the layer via
    // `setLayer:`), the layer's frame lives in the SUPERLAYER's
    // coordinate space (which is `WryWebViewParent`'s layer, NOT the
    // view we just framed). So we must put the layer at the same `(x,
    // frame_y, w, h)` as the view — not at `(0, 0, w, h)`, which plants
    // it at the corner of `WryWebViewParent` and produces the wrong-rect
    // result we saw in the first run.
    if let Some(lp) = layer_ptr.filter(|&p| p != 0) {
        let layer = &*(lp as *const CALayer);
        layer.setFrame(view_frame);
        // Re-sync contentsScale on every bounds change. Catches window
        // moves between Retina and non-Retina displays without
        // registering for `NSWindowDidChangeBackingProperties`.
        if let Some(window) = view.window() {
            let scale = window.backingScaleFactor();
            if (layer.contentsScale() - scale).abs() > f64::EPSILON {
                layer.setContentsScale(scale);
            }
        }
        layer.setNeedsDisplay();
    }
}

/// Raw C-ABI proc-address resolver for `mpv_render_context_create`'s
/// `mpv_opengl_init_params.get_proc_address`. Bridges to the
/// CoreFoundation-backed `gl_get_proc_address` helper below.
unsafe extern "C" fn gl_get_proc_address_raw(
    _ctx: *mut c_void,
    name: *const c_char,
) -> *mut c_void {
    if name.is_null() {
        return std::ptr::null_mut();
    }
    let cstr = std::ffi::CStr::from_ptr(name);
    let Ok(s) = cstr.to_str() else {
        return std::ptr::null_mut();
    };
    gl_get_proc_address(&(), s)
}

// -- OpenGL function pointer resolver -----------------------------------

/// Used by mpv's `mpv_render_context_create` (via `OpenGLInitParams`) to
/// look up GL function pointers. On macOS we resolve them through the
/// OpenGL framework bundle, which is the Apple-documented way.
fn gl_get_proc_address(_ctx: &(), name: &str) -> *mut c_void {
    unsafe {
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CFBundleGetBundleWithIdentifier(id: *const c_void) -> *mut c_void;
            fn CFBundleGetFunctionPointerForName(
                bundle: *mut c_void,
                name: *const c_void,
            ) -> *mut c_void;
            fn CFStringCreateWithCString(
                alloc: *const c_void,
                cstr: *const c_char,
                encoding: u32,
            ) -> *mut c_void;
            fn CFRelease(cf: *mut c_void);
        }
        static mut BUNDLE: *mut c_void = std::ptr::null_mut();
        if BUNDLE.is_null() {
            let id = CString::new("com.apple.opengl").unwrap();
            let s = CFStringCreateWithCString(
                std::ptr::null(),
                id.as_ptr(),
                0x08000100, // kCFStringEncodingUTF8
            );
            BUNDLE = CFBundleGetBundleWithIdentifier(s);
            CFRelease(s);
        }
        if BUNDLE.is_null() {
            return std::ptr::null_mut();
        }
        let name_c = match CString::new(name) {
            Ok(c) => c,
            Err(_) => return std::ptr::null_mut(),
        };
        let s = CFStringCreateWithCString(std::ptr::null(), name_c.as_ptr(), 0x08000100);
        let sym = CFBundleGetFunctionPointerForName(BUNDLE, s);
        CFRelease(s);
        sym
    }
}

// -- dispatch helper ----------------------------------------------------

async fn run_on_main<F, T>(app: &tauri::AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<T, String>>();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| format!("run_on_main_thread: {e}"))?;
    rx.await.map_err(|e| format!("main thread recv: {e}"))?
}
