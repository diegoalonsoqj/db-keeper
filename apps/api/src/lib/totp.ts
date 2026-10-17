import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) con los parámetros que usan Aegis, Google Authenticator y demás:
 * HMAC-SHA1, 6 dígitos, pasos de 30 s. Sin dependencias externas.
 */
const STEP_S = 30;
const DIGITS = 6;
/** Pasos de tolerancia hacia atrás/adelante por desfase de reloj (±30 s). */
const DRIFT = 1;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Base32 inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto nuevo de 160 bits (lo recomendado por la RFC 4226), en base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Código del paso indicado (HOTP sobre el contador de tiempo). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITS;
  return bin.toString().padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_S);

/**
 * Verifica un código y devuelve el paso que coincidió (null si no coincide). Rechaza
 * pasos <= `lastStep` para que un código ya usado no sirva otra vez (anti-replay).
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = currentStep(now);
  for (let s = cur - DRIFT; s <= cur + DRIFT; s++) {
    if (lastStep != null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

/** URI que leen las apps (otpauth://totp/…), para el QR. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_S) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ---- Códigos de recuperación (un solo uso) ----

const RC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I

/** Códigos tipo "K7PQ-M2XD" (40 bits de entropía cada uno). */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    let s = "";
    for (let i = 0; i < 8; i++) s += RC_ALPHABET[randomInt(RC_ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

/** Forma canónica (sin guion ni espacios, en mayúsculas) para comparar. */
export const normalizeRecoveryCode = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();

/** Hash de un código de recuperación (alta entropía: basta SHA-256, no hace falta scrypt). */
export const hashRecoveryCode = (code: string) => createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
