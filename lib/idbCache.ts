// Minimal IndexedDB key/value store for caching large payloads.
//
// The TV channel dataset is several MB — well over localStorage's ~5MB
// per-origin quota — so writes to localStorage threw QuotaExceededError, got
// swallowed, and the list re-downloaded on every launch. IndexedDB has no such
// practical limit and stores structured-clone values (no JSON.stringify round
// trip). One object store, string keys.
//
// Every operation degrades gracefully: if IndexedDB is unavailable or errors,
// reads resolve to null and writes resolve silently, so callers simply fall
// back to fetching fresh.

const DB_NAME = "mosaic";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | null> {
  return run<T>("readonly", (s) => s.get(key));
}

export function idbSet(key: string, value: unknown): Promise<unknown> {
  return run("readwrite", (s) => s.put(value, key));
}

export function idbDel(key: string): Promise<unknown> {
  return run("readwrite", (s) => s.delete(key));
}

export function idbKeys(): Promise<string[]> {
  return run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((keys) =>
    (keys ?? []).map(String),
  );
}
