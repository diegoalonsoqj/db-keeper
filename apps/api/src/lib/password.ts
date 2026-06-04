import { randomBytes, scrypt as scryptCb, type ScryptOptions, timingSafeEqual } from "node:crypto";

/** Wrapper a promesa de scrypt que sí acepta el objeto de opciones. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey),
    );
  });
}

/**
 * Hashing de contraseñas con scrypt (node:crypto, sin dependencias nativas).
 * scrypt es un KDF aprobado por OWASP. Formato almacenado:
 *   scrypt$N$r$p$<salt-b64>$<hash-b64>
 * Guardar los parámetros permite subir el costo en el futuro sin romper hashes viejos.
 */
const N = 16384; // costo CPU/memoria (2^14)
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password, salt, KEYLEN, { N, r: R, p: P })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const derived = (await scrypt(password, salt, expected.length, { N: n, r, p })) as Buffer;
  // Comparación en tiempo constante.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
