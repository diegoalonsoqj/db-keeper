import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import type { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { env } from "../../../config/env.js";
import type { DumpInput, DumpResult } from "./types.js";
import { verifyGzip } from "./verify.js";
import { pipeStderrLines, describeDumpExit, NATIVE_CLIENT_STDERR_ENCODING } from "./log-lines.js";
import { lowerPriority } from "./priority.js";
import { superviseDump, type DumpLimits } from "./supervise.js";
import { pgCompatFilter } from "./pg-compat.js";

/** Nivel de compresión gzip del dump (1=rápido … 9=máximo). */
const GZIP_LEVEL = 6;

/**
 * Vuelca una BD PostgreSQL con `pg_dump` en formato SQL plano (`-Fp`), con los
 * mismos parámetros que el script de referencia (`--no-owner --no-privileges
 * --serializable-deferrable`, apto para restaurar en Cloud SQL). La salida va por
 * stdout → [filtro de compatibilidad, `input.pgCompat`] → [gzip] → archivo:
 * `.sql.gz` (restaurable con `gunzip -c … | psql`) o SQL plano (`.sql`, `psql -f`).
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
    "--no-password", // nunca prompt interactivo: si falta auth, falla rápido
    ...(input.verbose ? ["--verbose"] : []), // progreso por objeto a stderr
    ...input.excludeTables.flatMap((t) => ["--exclude-table", t]),
    // Entre comillas dobles el patrón es literal (sin comodines * ? y respetando
    // mayúsculas); las comillas internas se duplican.
    ...(input.excludeSchemas ?? []).map((s) => `--exclude-schema="${s.replace(/"/g, '""')}"`),
  ];

  try {
    await runPgDump(
      args,
      {
        PGPASSWORD: input.password,
        ...(input.ssl ? { PGSSLMODE: "require" } : {}),
      },
      filePath,
      {
        pgCompat: input.pgCompat !== false, // por defecto sí
        compress: input.compress,
        limits: input.limits,
        onLog: input.onLog,
      },
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

/** Lanza pg_dump y canaliza stdout → [filtro de compatibilidad] → [gzip] → archivo. */
async function runPgDump(
  args: string[],
  extraEnv: Record<string, string>,
  filePath: string,
  opts: { pgCompat: boolean; compress: boolean; limits: DumpLimits; onLog?: (line: string) => void },
): Promise<void> {
  const child = spawn(env.PG_DUMP_PATH, args, {
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
  lowerPriority(child);
  const sup = superviseDump(child, filePath, opts.limits);

  const getStderr = pipeStderrLines(
    child.stderr,
    (line) => {
      sup.activity();
      opts.onLog?.(line);
    },
    NATIVE_CLIENT_STDERR_ENCODING,
  );

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.on("error", (err) =>
      reject(
        new Error(
          err.message.includes("ENOENT")
            ? `No se encontró pg_dump (${env.PG_DUMP_PATH}). Instálalo o ajusta PG_DUMP_PATH.`
            : err.message,
        ),
      ),
    );
  });

  const transforms: Transform[] = [];
  if (opts.pgCompat) transforms.push(pgCompatFilter());
  if (opts.compress) transforms.push(createGzip({ level: GZIP_LEVEL }));

  const streams: (NodeJS.ReadableStream | NodeJS.ReadWriteStream | NodeJS.WritableStream)[] = [
    child.stdout!,
    ...transforms,
    createWriteStream(filePath),
  ];
  let code: number | null;
  let signal: NodeJS.Signals | null;
  try {
    [, { code, signal }] = await Promise.all([pipeline(streams), closed]);
  } finally {
    sup.stop();
  }

  if (code !== 0) {
    throw new Error(
      describeDumpExit({
        tool: "pg_dump",
        code,
        signal,
        stopReason: sup.reason(),
        limits: opts.limits,
        stderr: getStderr(),
      }),
    );
  }
}
