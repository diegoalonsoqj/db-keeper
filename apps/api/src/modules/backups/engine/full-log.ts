import { createWriteStream, type WriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { logger } from "../../../config/logger.js";
import { hashFile } from "./checksum.js";
import { uploadToGcs, type GcsAuth } from "./gcs.js";

/**
 * Log completo de una BD como archivo (evidencia de auditoría): se escribe línea a
 * línea mientras corre el dump, sin acumular en memoria, y al terminar queda junto al
 * backup (disco o bucket) con su SHA-256. Nunca hace fallar el backup: si algo sale
 * mal se registra y el log en BD (resumen) sigue disponible.
 */

/** Archivo de log ya ubicado. `file`: ruta local absoluta o URI gs://. */
export interface FullLogRef {
  file: string;
  bytes: number;
  sha256: string;
}

/**
 * Dónde queda: en disco (donde se escribió) o subido al bucket. Subido, se borra del
 * disco aunque el dump conserve copia local: esa copia la purga la retención, el log no.
 */
export type FullLogDest = { kind: "local" } | { kind: "gcs"; auth: GcsAuth; objectName: string };

export interface FullLogWriter {
  /** Ruta local donde se escribe. */
  readonly path: string;
  write: (line: string) => void;
  /** Cierra el archivo y lo ubica; null si no se pudo escribir. */
  save: (dest: FullLogDest) => Promise<FullLogRef | null>;
}

export function createFullLog(localPath: string): FullLogWriter {
  let failed = false;
  let stream: WriteStream | null = createWriteStream(localPath, { flags: "w", encoding: "utf8", mode: 0o600 });
  stream.on("error", (err) => {
    failed = true;
    logger.warn({ err }, "No se pudo escribir el log completo de la BD");
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (!stream) return resolve();
      const s = stream;
      stream = null;
      if (s.destroyed) return resolve();
      s.end(() => resolve());
    });

  return {
    path: localPath,
    write(line) {
      if (stream && !failed) stream.write(`${line}\n`);
    },
    async save(dest) {
      await close();
      if (failed) {
        await rm(localPath, { force: true }).catch(() => {});
        return null;
      }
      try {
        const { size } = await stat(localPath);
        const { sha256 } = await hashFile(localPath);
        if (dest.kind === "local") return { file: localPath, bytes: size, sha256 };
        try {
          const uri = await uploadToGcs(dest.auth, localPath, dest.objectName, { sha256 });
          await rm(localPath, { force: true });
          return { file: uri, bytes: size, sha256 };
        } catch (err) {
          // Sin subir, el log sigue en disco: mejor esa evidencia que ninguna.
          logger.warn({ err, objectName: dest.objectName }, "No se pudo subir el log completo al bucket; queda en disco");
          return { file: localPath, bytes: size, sha256 };
        }
      } catch (err) {
        logger.warn({ err }, "No se pudo cerrar el log completo de la BD");
        return null;
      }
    },
  };
}
