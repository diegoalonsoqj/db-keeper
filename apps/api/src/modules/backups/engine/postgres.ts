import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { env } from "../../../config/env.js";
import type { DumpInput, DumpResult } from "./types.js";

/** Nivel de compresión gzip del dump (1=rápido … 9=máximo). */
const GZIP_LEVEL = 6;

/**
 * Vuelca una BD PostgreSQL con `pg_dump` en formato SQL plano (`-Fp`), igual que
 * los scripts de referencia. Según `input.compress` el propio pg_dump comprime
 * con gzip (`.sql.gz`, restaurable con `gunzip -c … | psql`) o deja SQL plano
 * (`.sql`, restaurable con `psql -f`). La contraseña viaja por `PGPASSWORD`
 * (nunca en la línea de comandos ni en logs) y los argumentos van como array
 * (sin shell), por lo que no hay riesgo de inyección.
 */
export async function dumpPostgres(input: DumpInput): Promise<DumpResult> {
  const filePath = `${input.destPathNoExt}${input.compress ? ".sql.gz" : ".sql"}`;
  const args = [
    "-h",
    input.host,
    "-p",
    String(input.port),
    "-U",
    input.user,
    "-d",
    input.dbName,
    "-Fp", // formato SQL plano
    ...(input.compress ? ["-Z", String(GZIP_LEVEL)] : []), // gzip por el propio pg_dump
    "--no-password", // nunca prompt interactivo: si falta auth, falla rápido
    "-f",
    filePath,
  ];

  await runPgDump(args, {
    PGPASSWORD: input.password,
    ...(input.ssl ? { PGSSLMODE: "require" } : {}),
  });

  const { size } = await stat(filePath);
  return { filePath, bytes: size };
}

/** Lanza pg_dump como proceso externo y resuelve/rechaza según el código de salida. */
function runPgDump(args: string[], extraEnv: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.PG_DUMP_PATH, args, {
      env: { ...process.env, ...extraEnv },
      timeout: env.BACKUP_TIMEOUT_MS,
      windowsHide: true,
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      // Acotar para no acumular un log gigante en memoria.
      if (stderr.length < 8000) stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(
        new Error(
          err.message.includes("ENOENT")
            ? `No se encontró pg_dump (${env.PG_DUMP_PATH}). Instálalo o ajusta PG_DUMP_PATH.`
            : err.message,
        ),
      );
    });

    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      const detail = stderr.trim() || (signal ? `terminado por señal ${signal}` : `código ${code}`);
      reject(new Error(detail));
    });
  });
}
