import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import type { FileChecksums } from "@dbkeeper/shared";
import { CRC32C } from "@google-cloud/storage";

/**
 * SHA-256 (hex), MD5 (hex) y CRC32C (base64, formato GCS) de un stream en una
 * sola pasada, sin cargarlo en memoria.
 */
export async function hashStream(stream: Readable): Promise<{ sha256: string; md5: string; crc32c: string }> {
  const sha = createHash("sha256");
  const md5 = createHash("md5");
  const crc = new CRC32C();
  for await (const chunk of stream) {
    sha.update(chunk as Buffer);
    md5.update(chunk as Buffer);
    crc.update(chunk as Buffer);
  }
  return { sha256: sha.digest("hex"), md5: md5.digest("hex"), crc32c: crc.toString() };
}

/** Checksums de un archivo local. */
export function hashFile(filePath: string): Promise<{ sha256: string; md5: string; crc32c: string }> {
  return hashStream(createReadStream(filePath));
}

/** MD5 de GCS (base64) → hex, el formato que muestran las herramientas locales. */
export function md5Base64ToHex(b64: string | null | undefined): string | null {
  return b64 ? Buffer.from(b64, "base64").toString("hex") : null;
}

/**
 * Compara los checksums registrados con los actuales. Solo cuenta los que existen
 * en ambos lados. Devuelve las diferencias (vacío = coincide) y cuántos se
 * compararon (0 = nada que comparar).
 */
export function compareChecksums(
  expected: FileChecksums,
  actual: Partial<FileChecksums>,
): { compared: number; diffs: string[] } {
  let compared = 0;
  const diffs: string[] = [];
  for (const [key, label] of [
    ["sha256", "SHA-256"],
    ["md5", "MD5"],
    ["crc32c", "CRC32C"],
  ] as const) {
    const exp = expected[key];
    const act = actual[key];
    if (!exp || !act) continue;
    compared++;
    if (exp !== act) diffs.push(`${label}: esperado ${exp}, actual ${act}`);
  }
  return { compared, diffs };
}
