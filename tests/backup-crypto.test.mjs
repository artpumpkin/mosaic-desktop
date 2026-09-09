import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptBackup, decryptBackup } from "../lib/io/backupCrypto.ts";

test("encrypted backups round trip without exposing the payload", async () => {
  const original = JSON.stringify({ version: 1, note: "Synthetic test account" });
  const backup = await encryptBackup(original, "a test-only passphrase");
  assert.equal(await decryptBackup(backup, "a test-only passphrase"), original);
  assert.ok(!JSON.stringify(backup).includes("Synthetic test account"));
  const second = await encryptBackup(original, "a test-only passphrase");
  assert.notEqual(second.ciphertext, backup.ciphertext);
});

test("incorrect passphrases and tampered ciphertext are rejected", async () => {
  const backup = await encryptBackup("example", "test passphrase");
  await assert.rejects(decryptBackup(backup, "wrong passphrase"), /Wrong passphrase/);
  const bytes = Buffer.from(backup.ciphertext, "base64");
  bytes[0] ^= 1;
  await assert.rejects(decryptBackup({ ...backup, ciphertext: bytes.toString("base64") }, "test passphrase"), /corrupted/);
});

test("hostile work factors and malformed crypto fields are rejected before key derivation", async () => {
  const backup = await encryptBackup("example", "test passphrase");
  for (const iterations of [0, -1, 1.5, 2_000_000_000]) {
    await assert.rejects(decryptBackup({ ...backup, kdf: { ...backup.kdf, iterations } }, "test"), /parameters/);
  }
  await assert.rejects(decryptBackup({ ...backup, cipher: { ...backup.cipher, iv: "AA==" } }, "test"), /Invalid backup/);
});
