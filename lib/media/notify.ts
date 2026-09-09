// Batch-complete feedback: a desktop notification (via the Tauri plugin) +
// a subtle two-note WebAudio chime. Both are best-effort and never throw.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function notifyDone(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    /* notifications unavailable — ignore */
  }
}

let ctx: AudioContext | null = null;

export function playChime(): void {
  try {
    ctx = ctx ?? new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.11;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  } catch {
    /* audio unavailable — ignore */
  }
}
