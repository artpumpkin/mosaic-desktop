let ctx: AudioContext | null = null;

export function playChatPing() {
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!ctx) ctx = new AC();
    const c = ctx;
    if (c.state === "suspended") void c.resume();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // ignore — audio is best-effort
  }
}
