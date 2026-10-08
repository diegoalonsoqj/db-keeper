import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { CRC32C } from "@google-cloud/storage";

/** SHA-256 (hex) y CRC32C (base64) de un archivo local en una sola lectura en streaming. */
export async function hashFile(filePath: string): Promise<{ sha256: string; crc32c: string }> {
  const sha = createHash("sha256");
  const crc = new CRC32C();
  for await (const chunk of createReadStream(filePath)) {
    sha.update(chunk as Buffer);
    crc.update(chunk as Buffer);
  }
  return { sha256: sha.digest("hex"), crc32c: crc.toString() };
}

/** MD5 de GCS (base64) → hex, el formato que muestran las herramientas locales. */
export function md5Base64ToHex(b64: string | null | undefined): string | null {
  return b64 ? Buffer.from(b64, "base64").toString("hex") : null;
}
