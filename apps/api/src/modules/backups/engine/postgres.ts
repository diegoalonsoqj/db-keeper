import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { env } from "../../../config/env.js";
import type { DumpInput, DumpResult } from "./types.js";
import { verifyGzip } from "./verify.js";
import { pipeStderrLines, summarizeStderr, NATIVE_CLIENT_STDERR_ENCODING } from "./log-lines.js";
import { lowerPriority } from "./priority.js";

/** Nivel de compresión gzip del dump (1=rápido … 9=máximo). */
const GZIP_LEVEL = 6;

/**
 * Vuelca una BD PostgreSQL con `pg_dump` en formato SQL plano (`-Fp`), con los
 * mismos parámetros que el script de referencia (`--no-owner --no-privileges
 * --serializable-deferrable`, apto para restaurar en Cloud SQL). Según
 * `input.compress` el propio pg_dump comprime con gzip (`.sql.gz`, restaurable
 * con `gunzip -c … | psql`) o deja SQL plano (`.sql`, restaurable con `psql -f`).
 * La contraseña viaja por `PGPASSWORD` (nunca en la línea de comandos ni en
 * logs) y los argumentos van como array (sin shell), por lo que no hay riesgo de
 * inyección.
 */
export async function dumpPostgres(input: DumpInput): Promise<DumpResult> {
  const filePath = `${input.destPathNoExt}${input.compress ? ".sql.gz" : ".sql"}`;
  const args = [
    "--no-owner", // no emite ALTER ... OWNER
    "--no-privileges", // omite GRANT/REVOKE
    "--serializable-deferrable", // snapshot consistente sin bloquear escrituras
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
    ...(input.verbose ? ["--verbose"] : []), // progreso por objeto a stderr
    ...input.excludeTables.flatMap((t) => ["--exclude-table", t]),
    // Entre comillas dobles el patrón es literal (sin comodines * ? y respetando
    // mayúsculas); las comillas internas se duplican.
    ...(input.excludeSchemas ?? []).map((s) => `--exclude-schema="${s.replace(/"/g, '""')}"`),
    "-f",
    filePath,
  ];

  try {
    await runPgDump(
      args,
      {
        PGPASSWORD: input.password,
        ...(input.ssl ? { PGSSLMODE: "require" } : {}),
      },
      input.onLog,
    );
    const { size } = await stat(filePath);
    if (size === 0) throw new Error("El dump quedó vacío");
    // Validar integridad: el .gz debe descomprimir sin error.
    if (input.compress) await verifyGzip(filePath);
    return { filePath, bytes: size };
  } catch (err) {
    // Limpiar el archivo parcial/corrupto para no dejar dumps inválidos.
    await rm(filePath, { force: true });
    throw err;
  }
}

/** Lanza pg_dump como proceso externo y resuelve/rechaza según el código de salida. */
function runPgDump(
  args: string[],
  extraEnv: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.PG_DUMP_PATH, args, {
      env: { ...process.env, ...extraEnv },
      timeout: env.BACKUP_TIMEOUT_MS,
      windowsHide: true,
    });
    lowerPriority(child);

    const getStderr = pipeStderrLines(child.stderr, (line) => onLog?.(line), NATIVE_CLIENT_STDERR_ENCODING);

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
      const detail = summarizeStderr(getStderr()) || (signal ? `terminado por señal ${signal}` : `código ${code}`);
      reject(new Error(detail));
    });
  });
}
