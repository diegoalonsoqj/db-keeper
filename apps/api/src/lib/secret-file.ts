import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Archivos temporales con secretos (p. ej. el `--config` de mongodump con la URI y su
 * contraseña): en una carpeta privada (700) del usuario de la API, no en /tmp, con
 * permisos 600. Quien los usa los borra al terminar; si el proceso cae a mitad, se
 * limpian al arrancar (`sweepStaleSecretFiles`).
 */
const PREFIX = "secret-";

function runDir(): string {
  return env.DBKEEPER_RUN_DIR ?? path.join(homedir(), ".dbkeeper", "run");
}

/** Escribe el contenido en un archivo nuevo de la carpeta privada y devuelve su ruta. */
export async function writeSecretFile(content: string, ext: string): Promise<string> {
  const dir = runDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700); // por si ya existía con otros permisos
  const file = path.join(dir, `${PREFIX}${randomUUID()}${ext}`);
  await writeFile(file, content, { mode: 0o600, flag: "wx" });
  return file;
}

/** Borra el archivo; nunca lanza (se llama en `finally`). */
export async function removeSecretFile(file: string): Promise<void> {
  await rm(file, { force: true }).catch((err) => logger.warn({ err, file }, "No se pudo borrar un archivo temporal con secretos"));
}

/**
 * Al arrancar: borra los que quedaron de una caída. Solo los de más de unos minutos:
 * un proceso que acaba de arrancar puede estar por leer el suyo (otra instancia en el
 * mismo host); pasado ese margen ya lo leyó y borrarlo no le afecta.
 */
const STALE_MS = 10 * 60_000;

export async function sweepStaleSecretFiles(): Promise<void> {
  const dir = runDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => null);
    if (st && Date.now() - st.mtimeMs > STALE_MS) {
      await removeSecretFile(file);
      removed++;
    }
  }
  if (removed > 0) logger.info({ removed }, "Archivos temporales con secretos de una caída anterior eliminados");
}
