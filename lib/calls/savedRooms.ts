"use client";

export type SavedRoom = {
  id: string;
  code: string;
  name: string;
  /** ms since epoch when first saved. */
  savedAt: number;
  /** ms since epoch when last joined. */
  lastJoinedAt: number;
};

const STORAGE_KEY = "mosaic.calls.savedRooms";

export function loadSavedRooms(): SavedRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedRoom[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is SavedRoom =>
        !!r &&
        typeof r.id === "string" &&
        typeof r.code === "string" &&
        typeof r.name === "string" &&
        typeof r.savedAt === "number" &&
        typeof r.lastJoinedAt === "number",
    );
  } catch {
    return [];
  }
}

function persist(rooms: SavedRoom[]): SavedRoom[] {
  if (typeof window === "undefined") return rooms;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  } catch {
    // ignore
  }
  return rooms;
}

/** Returns the saved room matching `code`, or null. Case-insensitive. */
export function findByCode(rooms: SavedRoom[], code: string): SavedRoom | null {
  const c = code.trim().toUpperCase();
  return rooms.find((r) => r.code.toUpperCase() === c) ?? null;
}

export function addRoom(code: string, name: string): SavedRoom[] {
  const rooms = loadSavedRooms();
  const existing = findByCode(rooms, code);
  const now = Date.now();
  if (existing) {
    existing.name = name.trim() || existing.name;
    existing.lastJoinedAt = now;
    return persist(rooms);
  }
  const next: SavedRoom = {
    id: crypto.randomUUID(),
    code: code.trim().toUpperCase(),
    name: name.trim() || code.trim().toUpperCase(),
    savedAt: now,
    lastJoinedAt: now,
  };
  return persist([next, ...rooms]);
}

export function renameRoom(id: string, name: string): SavedRoom[] {
  const rooms = loadSavedRooms();
  const r = rooms.find((x) => x.id === id);
  if (!r) return rooms;
  r.name = name.trim() || r.name;
  return persist(rooms);
}

export function removeRoom(id: string): SavedRoom[] {
  const rooms = loadSavedRooms().filter((r) => r.id !== id);
  return persist(rooms);
}

export function touchRoom(code: string): SavedRoom[] {
  const rooms = loadSavedRooms();
  const r = findByCode(rooms, code);
  if (!r) return rooms;
  r.lastJoinedAt = Date.now();
  return persist(rooms);
}
