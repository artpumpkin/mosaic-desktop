"use client";

// Placeholder component for the native libmpv video surface. Renders a
// transparent <div> at the position where video should appear; a
// sibling NSView positioned by Rust (see `src-tauri/src/mpv.rs`)
// draws into that exact rect.
//
// The video surface lives BELOW the WKWebView in z-order — the webview
// needs to be transparent for the video to show through. That's set
// globally via `transparent: true` in tauri.conf.json + body bg in
// CSS. This div should keep `background: transparent` so the mpv view
// underneath isn't obscured.
//
// Bounds sync: we measure the div's screen position relative to the
// window via `getBoundingClientRect()` and forward it to Rust through
// `mpv_set_bounds`. Triggers: mount, ResizeObserver on the div itself,
// and `resize` on the window. That covers all the ways layout could
// shift — sidebar collapse, window resize, content reflow, etc.

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { mpv, type MpvHandle } from "../mpv";
import { useFullscreen } from "./useFullscreen";
import { logger } from "../logger";

export type MpvPlayerRef = MpvHandle;

type Props = {
  /** Optional class on the placeholder div. Use it to size / position
   *  the video region with regular Tailwind layout. */
  className?: string;
};

export const MpvPlayer = forwardRef<MpvPlayerRef, Props>(function MpvPlayer(
  { className },
  ref,
) {
  const divRef = useRef<HTMLDivElement | null>(null);
  // When the Tauri window is fullscreen the page layout (sidebar +
  // max-width content) keeps the placeholder div the same size, so the
  // native NSView (which follows the placeholder) stays small inside
  // an otherwise-fullscreen window. We promote the placeholder to a
  // fixed overlay AND reserve a bottom strip so the controls bar
  // remains visible.
  const isFullscreen = useFullscreen();

  // Expose the singleton handle through the forwarded ref. Identical
  // shape across all MpvPlayer instances since there's only one mpv
  // engine — but the imperative-ref ergonomics match how MoviePlayer /
  // TVPlayer talk to their <video> elements today, which makes the
  // migration mechanical.
  useImperativeHandle(ref, () => mpv, []);

  useEffect(() => {
    const div = divRef.current;
    if (!div) return;
    let cancelled = false;
    let rafId: number | null = null;
    // Last rect we actually pushed to mpv. We compare against this on
    // each tick and skip the IPC if nothing meaningful changed —
    // scroll events fire often, but for any given event the
    // placeholder may not have moved (different scroll container, the
    // div is `position: fixed`, etc).
    let lastSent: { x: number; y: number; w: number; h: number } | null = null;

    const measureAndPush = () => {
      rafId = null;
      if (cancelled) return;
      const rect = div.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // Skip if within 1px of the last sent rect — the native view
      // can't render sub-pixel positioning differences anyway, and
      // every skipped IPC is one less round-trip to fight the
      // compositor scrolling. macOS scroll on a Retina display
      // typically nudges by 0.5px at a time; without this guard, we
      // were firing setBounds on every animation frame even when the
      // visible position was unchanged.
      const next = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      if (
        lastSent != null &&
        Math.abs(lastSent.x - next.x) < 1 &&
        Math.abs(lastSent.y - next.y) < 1 &&
        Math.abs(lastSent.w - next.w) < 1 &&
        Math.abs(lastSent.h - next.h) < 1
      ) {
        return;
      }
      lastSent = next;
      void mpv.setBounds(next).catch((e) => {
        logger.warn("player/mpv", "setBounds failed", { e: String(e) });
      });
    };

    // rAF-coalesce bounds updates. Scroll events on macOS fire much
    // faster than the IPC bridge can ack (we've seen 100+/sec on a
    // trackpad fling vs ~10ms per setBounds round-trip). Without
    // coalescing, the IPC queue fills up and the NSView lags many
    // frames behind the placeholder — visible jiggle. With rAF the
    // NSView still trails one frame, but consistently, and we never
    // queue more than one in-flight update.
    const pushBounds = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(measureAndPush);
    };

    void (async () => {
      try {
        await mpv.attach();
      } catch (e) {
        logger.error("player/mpv", "attach failed", { e: String(e) });
        return;
      }
      if (cancelled) return;
      // CRITICAL: invalidate `lastSent` before the post-attach push.
      // ResizeObserver / scroll listeners (attached below) may have
      // fired during the `await mpv.attach()` window — each call
      // updates `lastSent` BUT the Rust side returns early because
      // `host_view` isn't populated yet. Without this reset, the
      // next `pushBounds` would see "same rect as last time" and
      // skip, and the layer never receives a real frame — CA never
      // calls `drawInCGLContext:` because the layer stays at 0×0.
      lastSent = null;
      pushBounds();
    })();

    const ro = new ResizeObserver(pushBounds);
    ro.observe(div);
    window.addEventListener("resize", pushBounds);
    // `scroll` with capture=true catches scrolls in any container
    // ancestor, not just window. Passive=true tells the browser we
    // never preventDefault, which lets compositor scrolling stay
    // smooth (any sync work in the listener would block scroll
    // otherwise — rAF defers ours, but passive is the contract).
    window.addEventListener("scroll", pushBounds, { capture: true, passive: true });

    // Re-sync on DPI change — e.g. the window dragged between a Retina
    // and a non-Retina display. The logical (CSS-px) rect is UNCHANGED in
    // that case, so the 1px guard in measureAndPush would skip the push
    // and the native layer's contentsScale would stay wrong (blurry or
    // over-sharp video) until the next real layout change. Invalidate
    // lastSent to force a send; set_view_bounds re-applies the backing
    // scale on the native side.
    let scaleUnlisten: (() => void) | undefined;
    void (async () => {
      try {
        scaleUnlisten = await getCurrentWindow().onScaleChanged(() => {
          if (cancelled) return;
          lastSent = null;
          pushBounds();
        });
      } catch (e) {
        logger.warn("player/mpv", "onScaleChanged failed", { e: String(e) });
      }
    })();

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", pushBounds);
      window.removeEventListener("scroll", pushBounds, true);
      scaleUnlisten?.();
      // Shrink the native view to 0x0 when the placeholder unmounts so
      // the leftover NSView doesn't keep painting the last frame over
      // the next page.
      void mpv.setBounds({ x: 0, y: 0, w: 0, h: 0 }).catch(() => {});
    };
  }, []);

  return (
    <div
      ref={divRef}
      className={clsx(
        // In fullscreen, escape page layout and fill the viewport.
        // mpv NSView (sized to this rect) fills the whole screen; HTML
        // controls overlay normally on top via the new BELOW-webview
        // stacking. No need to reserve a bottom strip anymore.
        isFullscreen ? "fixed inset-0 z-[-1]" : className,
      )}
      // Transparent so the mpv NSView (positioned BELOW the webview)
      // shows through. We rely on the Tauri window's backgroundColor
      // for the opaque fallback when mpv isn't painting in the rect.
      style={{ background: "transparent" }}
    />
  );
});
