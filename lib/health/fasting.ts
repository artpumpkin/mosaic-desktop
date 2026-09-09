export type FastType = "omad" | "24h" | "48h" | "72h" | "1w" | "custom";

export const FAST_TYPE_LABEL: Record<FastType, string> = {
  omad: "OMAD",
  "24h": "24h",
  "48h": "48h",
  "72h": "72h",
  "1w": "1 week",
  custom: "Custom",
};

export const FAST_TARGET_HOURS: Record<Exclude<FastType, "custom">, number> = {
  omad: 23,
  "24h": 24,
  "48h": 48,
  "72h": 72,
  "1w": 168,
};

export function defaultTargetHours(type: FastType): number | null {
  if (type === "custom") return null;
  return FAST_TARGET_HOURS[type];
}

export function durationHours(startedAt: string, endedAt: string | null, now = Date.now()): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  return Math.max(0, (end - start) / 3_600_000);
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "0h";
  const totalSeconds = Math.floor(hours * 3600);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDurationShort(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "0h";
  const totalMinutes = Math.floor(hours * 60);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatClock(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "00:00:00";
  const totalSeconds = Math.max(0, Math.floor(hours * 3600));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export type FastStage = {
  key: string;
  emoji: string;
  label: string;
  description: string;
  startH: number;
  ringColor: string;
  textColor: string;
  bgColor: string;
};

export const FAST_STAGES: FastStage[] = [
  {
    key: "fed",
    emoji: "🍽️",
    label: "Fed",
    description: "Digesting and absorbing nutrients.",
    startH: 0,
    ringColor: "#fb923c",
    textColor: "text-amber-300",
    bgColor: "bg-amber-500/10 border-amber-400/25",
  },
  {
    key: "stable",
    emoji: "💧",
    label: "Stable",
    description: "Blood sugar settling, insulin dropping.",
    startH: 4,
    ringColor: "#38bdf8",
    textColor: "text-sky-300",
    bgColor: "bg-sky-500/10 border-sky-400/25",
  },
  {
    key: "fat_burn",
    emoji: "🔥",
    label: "Fat burning",
    description: "Glycogen low — burning fat for fuel.",
    startH: 12,
    ringColor: "#fb7185",
    textColor: "text-rose-300",
    bgColor: "bg-rose-500/10 border-rose-400/25",
  },
  {
    key: "ketosis",
    emoji: "⚡",
    label: "Ketosis",
    description: "Ketones rising, mental clarity kicks in.",
    startH: 18,
    ringColor: "#facc15",
    textColor: "text-yellow-300",
    bgColor: "bg-yellow-500/10 border-yellow-400/25",
  },
  {
    key: "autophagy",
    emoji: "♻️",
    label: "Autophagy",
    description: "Cells recycling damaged components.",
    startH: 24,
    ringColor: "#34d399",
    textColor: "text-emerald-300",
    bgColor: "bg-emerald-500/10 border-emerald-400/25",
  },
  {
    key: "deep_autophagy",
    emoji: "🧬",
    label: "Deep autophagy",
    description: "Growth hormone surging, deep repair.",
    startH: 48,
    ringColor: "#a78bfa",
    textColor: "text-violet-300",
    bgColor: "bg-violet-500/10 border-violet-400/25",
  },
  {
    key: "renewal",
    emoji: "🌟",
    label: "Renewal",
    description: "Stem cell regeneration, immune reset.",
    startH: 72,
    ringColor: "#f0abfc",
    textColor: "text-fuchsia-300",
    bgColor: "bg-fuchsia-500/10 border-fuchsia-400/25",
  },
];

export function stageForHours(h: number): FastStage {
  let stage = FAST_STAGES[0];
  for (const s of FAST_STAGES) {
    if (h >= s.startH) stage = s;
  }
  return stage;
}

export function nextStageAfter(h: number): FastStage | null {
  return FAST_STAGES.find((s) => s.startH > h) ?? null;
}
