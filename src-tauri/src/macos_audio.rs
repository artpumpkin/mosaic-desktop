//! macOS-only: capture system audio via ScreenCaptureKit and stream the
//! PCM samples to the frontend over a Tauri IPC channel. The frontend
//! reassembles them into a `MediaStreamTrack` via Web Audio so they can
//! be added to the existing WebRTC peer connection alongside the
//! `getDisplayMedia` video track.
//!
//! Why this exists: Tauri uses WKWebView on macOS, and Safari's
//! `getDisplayMedia` returns video-only. ScreenCaptureKit is Apple's
//! supported path for system-audio capture from a regular app (no
//! kernel extension, no virtual audio driver) and is the same API
//! Zoom / Slack-huddles use natively.
//!
//! We use the pure-Rust `objc2-screen-capture-kit` binding rather than
//! `screencapturekit` (which carries a Swift bridge) so the build only
//! needs Command Line Tools, not a full Xcode install.
//!
//! The whole module compiles to no-op stubs on non-macOS so the
//! `invoke_handler!` macro can reference the commands unconditionally.

#[cfg(target_os = "macos")]
mod imp {
    use std::ptr::NonNull;
    use std::sync::{Mutex, OnceLock};

    use block2::RcBlock;
    use dispatch2::{DispatchQueue, DispatchQueueAttr, DispatchRetained};
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, msg_send, AllocAnyThread};
    use objc2_core_audio_types::AudioBufferList;
    use objc2_core_foundation::CFRetained;
    use objc2_core_media::CMSampleBuffer;
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol};
    use objc2_screen_capture_kit::{
        SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
        SCStreamOutputType,
    };
    use tauri::ipc::Channel;

    /// Bag of state held by the live capture session. Stored process-wide
    /// because only one screen-share-with-audio session can run at a
    /// time and its lifecycle is bounded by user start/stop clicks.
    struct Active {
        stream: Retained<SCStream>,
        output: Retained<AudioOutput>,
        // Keep the queue alive until we drop the stream — SCStream holds
        // it weakly.
        _queue: DispatchRetained<DispatchQueue>,
    }

    // Safety: SCStream / SCStreamOutput from objc2-screen-capture-kit are
    // not auto-Send because Objective-C objects are conservatively !Send.
    // We only access these from the Tauri command thread (start) and
    // teardown thread (stop), holding the global Mutex; the SCStream's
    // own internal queue handles concurrency. Audio callbacks live in
    // the AudioOutput's ivars (Channel<Vec<f32>>, which is Send+Sync).
    unsafe impl Send for Active {}

    static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

    /// The Channel the audio callback writes into. We park it inside an
    /// `OnceLock<Mutex<...>>` because objc2 ivars can't (easily) carry
    /// arbitrary Rust types across the FFI boundary, and the channel is
    /// effectively global state anyway (only one capture at a time).
    static AUDIO_CHANNEL: OnceLock<Mutex<Option<Channel<Vec<f32>>>>> = OnceLock::new();

    fn set_channel(c: Option<Channel<Vec<f32>>>) {
        let slot = AUDIO_CHANNEL.get_or_init(|| Mutex::new(None));
        let mut g = slot.lock().expect("audio channel mutex");
        *g = c;
    }

    fn send_chunk(samples: Vec<f32>) {
        let Some(slot) = AUDIO_CHANNEL.get() else {
            return;
        };
        let g = slot.lock().expect("audio channel mutex");
        if let Some(ch) = g.as_ref() {
            let _ = ch.send(samples);
        }
    }

    // -- Custom SCStreamOutput class -------------------------------------------------

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "MosaicSCAudioOutput"]
        #[derive(Debug)]
        struct AudioOutput;

        unsafe impl NSObjectProtocol for AudioOutput {}

        unsafe impl SCStreamOutput for AudioOutput {
            #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
            #[allow(non_snake_case)]
            fn stream_didOutputSampleBuffer_ofType(
                &self,
                _stream: &SCStream,
                sample_buffer: &CMSampleBuffer,
                of_type: SCStreamOutputType,
            ) {
                if of_type != SCStreamOutputType::Audio {
                    return;
                }
                handle_audio_sample(sample_buffer);
            }
        }
    );

    impl AudioOutput {
        fn new() -> Retained<Self> {
            let alloc = Self::alloc();
            unsafe { msg_send![alloc, init] }
        }
    }

    /// Extract PCM from a CMSampleBuffer and ship it interleaved-stereo
    /// down the channel. SCK delivers Float32, usually planar (one
    /// AudioBuffer per channel); we interleave so the JS worklet can
    /// write straight into Web Audio channel arrays.
    fn handle_audio_sample(sample_buffer: &CMSampleBuffer) {
        // ABL with room for up to 2 buffers (planar stereo). The
        // SCK config we set asks for 2 channels.
        #[repr(C)]
        struct Abl2 {
            m_number_buffers: u32,
            m_buffers: [objc2_core_audio_types::AudioBuffer; 2],
        }
        let mut abl = Abl2 {
            m_number_buffers: 2,
            m_buffers: [
                objc2_core_audio_types::AudioBuffer {
                    mNumberChannels: 0,
                    mDataByteSize: 0,
                    mData: std::ptr::null_mut(),
                },
                objc2_core_audio_types::AudioBuffer {
                    mNumberChannels: 0,
                    mDataByteSize: 0,
                    mData: std::ptr::null_mut(),
                },
            ],
        };
        let mut block_buffer_ptr: *mut objc2_core_media::CMBlockBuffer = std::ptr::null_mut();

        // kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment = 1
        let status = unsafe {
            sample_buffer.audio_buffer_list_with_retained_block_buffer(
                std::ptr::null_mut(),
                &mut abl as *mut Abl2 as *mut AudioBufferList,
                std::mem::size_of::<Abl2>(),
                None,
                None,
                1,
                &mut block_buffer_ptr,
            )
        };
        if status != 0 {
            return;
        }
        // Take ownership of the retained block buffer via CFRetained so
        // it's released when this scope ends, even on early returns.
        // (The "_retained" suffix on the SCK API means we're handed a
        // +1 reference and are responsible for releasing it.)
        let _block_buffer_owned = NonNull::new(block_buffer_ptr)
            .map(|p| unsafe { CFRetained::<objc2_core_media::CMBlockBuffer>::from_raw(p) });

        let num_buffers = abl.m_number_buffers.min(2) as usize;
        if num_buffers == 0 {
            return;
        }

        // Frame count: each Float32 sample is 4 bytes; the buffer holds
        // mNumberChannels interleaved channels (typically 1 in planar
        // delivery, where each AudioBuffer is one channel).
        let bytes_per_sample = std::mem::size_of::<f32>();
        let first = &abl.m_buffers[0];
        if first.mDataByteSize == 0 || first.mData.is_null() {
            return;
        }
        let first_channels = first.mNumberChannels.max(1) as usize;
        let frames = (first.mDataByteSize as usize) / bytes_per_sample / first_channels;
        if frames == 0 {
            return;
        }

        // Read each AudioBuffer as f32 samples.
        let mut channel_slices: Vec<&[f32]> = Vec::with_capacity(2);
        for i in 0..num_buffers {
            let buf = &abl.m_buffers[i];
            if buf.mData.is_null() || buf.mDataByteSize == 0 {
                continue;
            }
            let len = (buf.mDataByteSize as usize) / bytes_per_sample;
            let slice: &[f32] = unsafe { std::slice::from_raw_parts(buf.mData as *const f32, len) };
            channel_slices.push(slice);
        }
        if channel_slices.is_empty() {
            return;
        }

        // Interleave to L/R. Handle three layouts:
        //   1. 2 planar buffers (L, R)          → straightforward L/R
        //   2. 1 planar buffer with 2 channels  → already interleaved
        //   3. 1 mono buffer                    → duplicate to stereo
        let mut interleaved: Vec<f32> = Vec::with_capacity(frames * 2);
        if channel_slices.len() == 2 {
            let l = channel_slices[0];
            let r = channel_slices[1];
            for f in 0..frames.min(l.len()).min(r.len()) {
                interleaved.push(l[f]);
                interleaved.push(r[f]);
            }
        } else {
            // single buffer; check if it's interleaved stereo or mono
            let s = channel_slices[0];
            let ch = first.mNumberChannels.max(1) as usize;
            if ch >= 2 {
                // already L/R/L/R; copy as-is (truncate to even length)
                let take = (s.len() / 2) * 2;
                interleaved.extend_from_slice(&s[..take]);
            } else {
                for f in 0..frames.min(s.len()) {
                    interleaved.push(s[f]);
                    interleaved.push(s[f]);
                }
            }
        }

        if !interleaved.is_empty() {
            send_chunk(interleaved);
        }
    }

    // -- Public Tauri-side API -------------------------------------------------------

    pub fn start(channel: Channel<Vec<f32>>) -> Result<(), String> {
        {
            let guard = ACTIVE.lock().map_err(|e| e.to_string())?;
            if guard.is_some() {
                return Err("system audio capture already running".into());
            }
        }

        // Get shareable content (this is the call that may trigger the
        // OS Screen Recording permission prompt the first time around).
        let content = get_shareable_content()?;
        let displays = unsafe { content.displays() };
        if displays.count() == 0 {
            return Err("no displays available".into());
        }
        // Safety: count() > 0, so objectAtIndex:0 is valid.
        let display = displays.objectAtIndex(0);

        // Empty NSArray for the "exclude these windows" parameter.
        let empty: Retained<objc2_foundation::NSArray<objc2_screen_capture_kit::SCWindow>> =
            objc2_foundation::NSArray::new();
        let filter = unsafe {
            let alloc = SCContentFilter::alloc();
            SCContentFilter::initWithDisplay_excludingWindows(alloc, &display, &empty)
        };

        // Audio-only config. SCK requires a video output too, so we
        // minimize it (2x2) and never subscribe to screen frames.
        let config = unsafe {
            let c = SCStreamConfiguration::new();
            c.setCapturesAudio(true);
            c.setSampleRate(48000);
            c.setChannelCount(2);
            c.setExcludesCurrentProcessAudio(true);
            c.setWidth(2);
            c.setHeight(2);
            c
        };

        let stream = unsafe {
            let alloc = SCStream::alloc();
            SCStream::initWithFilter_configuration_delegate(alloc, &filter, &config, None)
        };

        let output = AudioOutput::new();
        let queue = DispatchQueue::new("mosaic.sck.audio", DispatchQueueAttr::SERIAL);
        let output_proto: &ProtocolObject<dyn SCStreamOutput> = ProtocolObject::from_ref(&*output);
        unsafe {
            stream
                .addStreamOutput_type_sampleHandlerQueue_error(
                    output_proto,
                    SCStreamOutputType::Audio,
                    Some(&queue),
                )
                .map_err(|e| format!("addStreamOutput: {e:?}"))?;
        }

        // Wire the channel so the audio callback can find it.
        set_channel(Some(channel));

        // Start capture; block until the completion handler fires.
        start_capture(&stream)?;

        let active = Active {
            stream,
            output,
            _queue: queue,
        };
        {
            let mut guard = ACTIVE.lock().map_err(|e| e.to_string())?;
            *guard = Some(active);
        }
        Ok(())
    }

    pub fn stop() -> Result<(), String> {
        let active = {
            let mut guard = ACTIVE.lock().map_err(|e| e.to_string())?;
            guard.take()
        };
        // Drop the channel reference first so any in-flight callback
        // doesn't try to send into a closed channel.
        set_channel(None);
        if let Some(active) = active {
            // Best-effort stop; ignore errors so we always release state.
            let _ = stop_capture(&active.stream);
            // Detach the output (defensive — drop should clean it up too).
            let proto: &ProtocolObject<dyn SCStreamOutput> =
                ProtocolObject::from_ref(&*active.output);
            unsafe {
                let _ = active
                    .stream
                    .removeStreamOutput_type_error(proto, SCStreamOutputType::Audio);
            }
        }
        Ok(())
    }

    // -- Block-based completion handler helpers --------------------------------------
    //
    // ScreenCaptureKit's permission-prompt + capture lifecycle APIs are
    // block-callback based. We bridge each one to a std sync_channel so
    // the synchronous Rust command can block until the callback fires.

    fn get_shareable_content() -> Result<Retained<SCShareableContent>, String> {
        let (tx, rx) =
            std::sync::mpsc::sync_channel::<Result<Retained<SCShareableContent>, String>>(1);
        let tx_cell = std::sync::Mutex::new(Some(tx));
        let block = RcBlock::new(move |content: *mut SCShareableContent, err: *mut NSError| {
            let result: Result<Retained<SCShareableContent>, String> = if !err.is_null() {
                let msg = unsafe { (*err).localizedDescription() };
                Err(format!("SCShareableContent: {}", msg))
            } else if content.is_null() {
                Err("SCShareableContent: null result".into())
            } else {
                unsafe { Retained::retain(content) }
                    .ok_or_else(|| "SCShareableContent retain failed".to_string())
            };
            if let Ok(mut g) = tx_cell.lock() {
                if let Some(tx) = g.take() {
                    let _ = tx.send(result);
                }
            }
        });
        unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
        rx.recv()
            .map_err(|e| format!("get_shareable_content recv: {e}"))?
    }

    fn start_capture(stream: &SCStream) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
        let tx_cell = std::sync::Mutex::new(Some(tx));
        let block = RcBlock::new(move |err: *mut NSError| {
            let result: Result<(), String> = if err.is_null() {
                Ok(())
            } else {
                let msg = unsafe { (*err).localizedDescription() };
                Err(format!("startCapture: {}", msg))
            };
            if let Ok(mut g) = tx_cell.lock() {
                if let Some(tx) = g.take() {
                    let _ = tx.send(result);
                }
            }
        });
        unsafe { stream.startCaptureWithCompletionHandler(Some(&block)) };
        rx.recv().map_err(|e| format!("start_capture recv: {e}"))?
    }

    fn stop_capture(stream: &SCStream) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
        let tx_cell = std::sync::Mutex::new(Some(tx));
        let block = RcBlock::new(move |err: *mut NSError| {
            let result: Result<(), String> = if err.is_null() {
                Ok(())
            } else {
                let msg = unsafe { (*err).localizedDescription() };
                Err(format!("stopCapture: {}", msg))
            };
            if let Ok(mut g) = tx_cell.lock() {
                if let Some(tx) = g.take() {
                    let _ = tx.send(result);
                }
            }
        });
        unsafe { stream.stopCaptureWithCompletionHandler(Some(&block)) };
        rx.recv().map_err(|e| format!("stop_capture recv: {e}"))?
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::ipc::Channel;
    pub fn start(_channel: Channel<Vec<f32>>) -> Result<(), String> {
        Err("system audio capture is only supported on macOS".into())
    }
    pub fn stop() -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn start_macos_system_audio(channel: tauri::ipc::Channel<Vec<f32>>) -> Result<(), String> {
    imp::start(channel)
}

#[tauri::command]
pub fn stop_macos_system_audio() -> Result<(), String> {
    imp::stop()
}
