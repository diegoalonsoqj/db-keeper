import { createReadStream } from "node:fs";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

/** Sumidero que descarta los datos (equivalente a redirigir a /dev/null). */
function devNull(): Writable {
  return new Writable({ write: (_chunk, _enc, cb) => cb() });
}

/**
 * Verifica la integridad de un archivo gzip leyéndolo y descomprimiéndolo por
 * completo (equivalente a `gunzip -t`). Lanza si el archivo está corrupto.
 */
export async function verifyGzip(filePath: string): Promise<void> {
  await pipeline(createReadStream(filePath), createGunzip(), devNull());
}
