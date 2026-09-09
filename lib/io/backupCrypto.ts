// Passphrase-based encryption for backup files.
//
// Envelope format (the JSON written to disk):
// {
//   "version": 1,
//   "encrypted": true,
//   "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<b64>" },
//   "cipher": { "name": "AES-GCM", "iv": "<b64>" },
//   "ciphertext": "<b64>"            // ciphertext + 16-byte GCM tag
// }
//
// The ciphertext, once decrypted, is the inner Export JSON produced by
// lib/io/serialize.ts. The migration script writes this same envelope.

export const ENVELOPE_VERSION = 1;
export const PBKDF2_ITERATIONS = 600000;

export type EncryptedEnvelope = {
  version: number;
  encrypted: true;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
  };
  ciphertext: string;
};

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

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedEnvelope> {
  if (!passphrase) throw new Error("Passphrase cannot be empty");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as BufferSource,
    ),
  );
  return {
    version: ENVELOPE_VERSION,
    encrypted: true,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: b64encode(salt),
    },
    cipher: { name: "AES-GCM", iv: b64encode(iv) },
    ciphertext: b64encode(ct),
  };
}

export async function decryptBackup(
  envelope: EncryptedEnvelope,
  passphrase: string,
): Promise<string> {
  if (envelope.version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported envelope version: ${envelope.version}`);
  }
  if (envelope.kdf.name !== "PBKDF2" || envelope.kdf.hash !== "SHA-256") {
    throw new Error(`Unsupported KDF: ${envelope.kdf.name}/${envelope.kdf.hash}`);
  }
  if (envelope.cipher.name !== "AES-GCM") {
    throw new Error(`Unsupported cipher: ${envelope.cipher.name}`);
  }
  if (envelope.encrypted !== true || !Number.isInteger(envelope.kdf.iterations) || envelope.kdf.iterations < 100_000 || envelope.kdf.iterations > 1_000_000
    || typeof envelope.ciphertext !== "string" || envelope.ciphertext.length > 24 * 1024 * 1024) {
    throw new Error("Invalid backup parameters or excessive work factor");
  }
  const salt = b64decode(envelope.kdf.salt);
  const iv = b64decode(envelope.cipher.iv);
  const ct = b64decode(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ct.length < 16) throw new Error("Invalid backup salt, IV or authentication tag");
  const key = await deriveKey(passphrase, salt, envelope.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
  } catch {
    throw new Error("Wrong passphrase or corrupted backup file");
  }
  return new TextDecoder().decode(plain);
}

export function isEncryptedEnvelope(obj: unknown): obj is EncryptedEnvelope {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return o.encrypted === true && typeof o.ciphertext === "string";
}
