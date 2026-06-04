import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Cifrado simétrico de secretos a nivel de aplicación (AES-256-GCM).
 * La clave maestra (32 bytes) llega en base64 por `DBKEEPER_MASTER_KEY`.
 * Formato del token almacenado: base64( iv(12) | authTag(16) | ciphertext ).
 *
 * Nunca se persisten secretos en claro ni se loguean (ver CLAUDE.md §4).
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function masterKey(): Buffer {
  const key = Buffer.from(env.DBKEEPER_MASTER_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      "DBKEEPER_MASTER_KEY debe ser de 32 bytes en base64. Genera una con: " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(token: string): string {
  const buf = Buffer.from(token, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
