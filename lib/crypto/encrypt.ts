import { invoke } from "@tauri-apps/api/core";

let cachedKey: CryptoKey | null = null;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== 64) throw new Error("Encryption key must be 64 hex chars");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const hex = await invoke<string>("get_or_create_enc_key");
  const raw = hexToBytes(hex);
  cachedKey = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );
  // WebCrypto returns ciphertext||tag (last 16 bytes are the tag), but for
  // compatibility with the legacy "iv.tag.ct" format we split them out.
  const tag = ctTag.slice(ctTag.length - 16);
  const ct = ctTag.slice(0, ctTag.length - 16);
  return `${b64encode(iv)}.${b64encode(tag)}.${b64encode(ct)}`;
}

export async function decrypt(payload: string): Promise<string> {
  const key = await getKey();
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed ciphertext");
  const iv = b64decode(ivB64);
  const tag = b64decode(tagB64);
  const ct = b64decode(ctB64);
  const ctTag = new Uint8Array(ct.length + tag.length);
  ctTag.set(ct, 0);
  ctTag.set(tag, ct.length);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ctTag as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(
      "Could not decrypt stored secret — the local encryption key has changed. " +
        "Re-import your backup or re-enter the API key.",
    );
  }
}
