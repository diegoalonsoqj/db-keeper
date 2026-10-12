import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, pgRestorePath } from "../../../config/env.js";
import { pipeStderrLines, describeDumpExit, NATIVE_CLIENT_STDERR_ENCODING } from "./log-lines.js";
import { lowerPriority } from "./priority.js";
import { superviseDump, type DumpLimits } from "./supervise.js";
import { quotedPatternArgs } from "./pg-args.js";
import { assertExcludeExtensionSupported } from "./postgres.js";
import { assertSafeDbName } from "./db-name.js";

export interface ParallelDumpInput {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  dbName: string;
  /** Workers de pg_dump (`-j`). */
  jobs: number;
  compress: boolean;
  /** `--no-privileges`: sin GRANT/REVOKE. */
  noPrivileges: boolean;
  excludeTables: string[];
  excludeSchemas: string[];
  excludeExtensions: string[];
  /** En -Fd no se pueden quitar del dump: se marcan en `restore.list`. */
  excludeEventTriggers: string[];
  verbose: boolean;
  /** Líneas de stderr que contienen alguno de estos textos no se muestran. */
  stderrIgnore: string[];
  /** Carpeta de salida; no debe existir (pg_dump la crea). */
  destDir: string;
  limits: DumpLimits;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export interface ParallelDumpResult {
  dir: string;
  bytes: number;
  files: number;
  /** Entradas del TOC según `pg_restore --list` (validación del dump). */
  tocEntries: number;
  /** Líneas de stderr descartadas por `stderrIgnore`. */
  ignoredLines: number;
  /** Event triggers marcados como omitidos en `restore.list`. */
  skippedEventTriggers: string[];
}

/** Lista de restauración con los event triggers excluidos (pg_restore -L). */
export const RESTORE_LIST = "restore.list";

/** Suma del tamaño de los archivos de una carpeta (recursiva). */
export async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(p);
      bytes += sub.bytes;
      files += sub.files;
    } else if (e.isFile()) {
      bytes += (await stat(p)).size;
      files++;
    }
  }
  return { bytes, files };
}

/** ¿La línea de stderr es ruido configurado? (texto literal, sin regex: sin ReDoS). */
export function isIgnoredLine(line: string, patterns: string[]): boolean {
  return patterns.some((p) => p && line.includes(p));
}

/**
 * Comenta (`;`) en la salida de `pg_restore --list` las entradas de los event
 * triggers indicados. Devuelve la lista nueva y los nombres omitidos.
 */
export function filterRestoreList(list: string, eventTriggers: string[]): { text: string; skipped: string[] } {
  const wanted = new Set(eventTriggers);
  const skipped: string[] = [];
  const text = list
    .split("\n")
    .map((line) => {
      const m = /^\d+;.*\bEVENT TRIGGER - (\S+)/.exec(line);
      if (m && wanted.has(m[1]!)) {
        skipped.push(m[1]!);
        return `;${line}`;
      }
      return line;
    })
    .join("\n");
  return { text, skipped };
}

/** Entradas reales del TOC (las líneas que no son comentarios). */
export function countTocEntries(list: string): number {
  return list.split("\n").filter((l) => /^\d+;/.test(l)).length;
}

/**
 * Vuelca una BD PostgreSQL en formato directorio (`pg_dump -Fd -j N`): un archivo
 * por tabla escrito en paralelo; es el único formato que admite `-j`. Igual que el
 * script original: `--no-owner` siempre y permisos (GRANT) salvo `noPrivileges`.
 * Contraseña por `PGPASSWORD` y argumentos como array (sin shell). Tras el dump,
 * valida el TOC con `pg_restore --list`.
 */
export async function dumpPostgresDirectory(input: ParallelDumpInput): Promise<ParallelDumpResult> {
  assertSafeDbName(input.dbName);
  if (input.excludeExtensions.length > 0) await assertExcludeExtensionSupported();
  const exists = await access(input.destDir).then(
    () => true,
    () => false,
  );
  if (exists) throw new Error(`La carpeta de salida ya existe: ${input.destDir}`);

  const args = [
    "--no-owner",
    ...(input.noPrivileges ? ["--no-privileges"] : []),
    "--no-password",
    "-h",
    input.host,
    "-p",
    String(input.port),
    "-U",
    input.user,
    "-d",
    input.dbName,
    "-Fd",
    "-j",
    String(input.jobs),
    // -Fd comprime con gzip por defecto; -Z 0 lo desactiva.
    ...(input.compress ? [] : ["-Z", "0"]),
    ...(input.verbose ? ["--verbose"] : []),
    ...input.excludeTables.flatMap((t) => ["--exclude-table", t]),
    ...quotedPatternArgs("--exclude-schema", input.excludeSchemas),
    ...quotedPatternArgs("--exclude-extension", input.excludeExtensions),
    "-f",
    input.destDir,
  ];

  const ignoredLines = await runPgDumpDir(args, input);
  const { bytes, files } = await dirSize(input.destDir);
  if (files === 0) throw new Error("El dump quedó vacío");

  const list = await pgRestoreList(input.destDir);
  const tocEntries = countTocEntries(list);
  if (tocEntries === 0) throw new Error("pg_restore --list no encontró entradas en el TOC del dump");

  let skippedEventTriggers: string[] = [];
  if (input.excludeEventTriggers.length > 0) {
    const filtered = filterRestoreList(list, input.excludeEventTriggers);
    skippedEventTriggers = filtered.skipped;
    await writeFile(path.join(input.destDir, RESTORE_LIST), filtered.text);
  }
  return { dir: input.destDir, bytes, files, tocEntries, ignoredLines, skippedEventTriggers };
}

/** Termina pg_dump y sus workers (grupo de procesos en Linux). */
function terminateTree(child: ChildProcess): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Sin grupo (ya terminó): cae al kill normal.
    }
  }
  child.kill("SIGTERM");
}

async function runPgDumpDir(args: string[], input: ParallelDumpInput): Promise<number> {
  if (input.signal?.aborted) throw new Error("Cancelada");
  const child = spawn(env.PG_DUMP_PATH, args, {
    env: { ...process.env, PGPASSWORD: input.password, ...(input.ssl ? { PGSSLMODE: "require" } : {}) },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
    // Grupo de procesos propio: al cancelar o cortar se terminan también los workers.
    detached: process.platform !== "win32",
  });
  lowerPriority(child);
  const terminate = (): void => terminateTree(child);
  const sup = superviseDump(child, () => dirSize(input.destDir).then((s) => s.bytes).catch(() => 0), input.limits, terminate);
  input.signal?.addEventListener("abort", terminate, { once: true });

  let ignored = 0;
  const getStderr = pipeStderrLines(
    child.stderr!,
    (line) => {
      sup.activity();
      if (isIgnoredLine(line, input.stderrIgnore)) ignored++;
      else input.onLog?.(line);
    },
    NATIVE_CLIENT_STDERR_ENCODING,
  );

  let code: number | null;
  let signal: NodeJS.Signals | null;
  try {
    ({ code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.on("close", (c, s) => resolve({ code: c, signal: s }));
      child.on("error", (err) =>
        reject(
          new Error(
            err.message.includes("ENOENT")
              ? `No se encontró pg_dump (${env.PG_DUMP_PATH}). Instálalo o ajusta PG_DUMP_PATH.`
              : err.message,
          ),
        ),
      );
    }));
  } finally {
    sup.stop();
    input.signal?.removeEventListener("abort", terminate);
  }

  if (input.signal?.aborted) throw new Error("Cancelada");
  if (code !== 0) {
    throw new Error(
      describeDumpExit({ tool: "pg_dump", code, signal, stopReason: sup.reason(), limits: input.limits, stderr: getStderr() }),
    );
  }
  return ignored;
}

/** Salida de `pg_restore --list` (lanza si el TOC no se puede leer). */
function pgRestoreList(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      pgRestorePath,
      ["--list", dir],
      { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
            ? `No se encontró pg_restore (${pgRestorePath}). Viene en el mismo paquete que pg_dump; si está en otra carpeta, indica PG_RESTORE_PATH.`
            : `pg_restore --list falló: ${String(stderr).trim() || err.message}`;
          reject(new Error(msg));
        } else resolve(String(stdout));
      },
    );
  });
}
