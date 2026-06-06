import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { env } from "../../../config/env.js";
import type { DumpInput, DumpResult } from "./types.js";
import { verifyGzip } from "./verify.js";

const GZIP_LEVEL = 6;

/**
 * Vuelca una BD MySQL con `mysqldump`, con los mismos parámetros que el script de
 * referencia (`--single-transaction --quick --routines --triggers --events
 * --hex-blob --set-gtid-purged=OFF`). Opcionalmente quita las cláusulas `DEFINER`
 * (compat. Cloud SQL) y comprime con gzip. La contraseña viaja por `MYSQL_PWD`
 * (no en la línea de comandos) y los argumentos van como array (sin shell).
 */
export async function dumpMysql(input: DumpInput): Promise<DumpResult> {
  const filePath = `${input.destPathNoExt}${input.compress ? ".sql.gz" : ".sql"}`;
  const cleanDefiners = input.cleanDefiners !== false; // por defecto sí
  const args = [
    `--host=${input.host}`,
    `--port=${input.port}`,
    `--user=${input.user}`,
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "--events",
    "--hex-blob",
    "--set-gtid-purged=OFF",
    ...(input.ssl ? ["--ssl-mode=REQUIRED"] : []),
    ...input.excludeTables.map((t) => `--ignore-table=${t.includes(".") ? t : `${input.dbName}.${t}`}`),
    input.dbName,
  ];

  try {
    await runMysqldump(args, input.password, filePath, { cleanDefiners, compress: input.compress });
    const { size } = await stat(filePath);
    if (size === 0) throw new Error("El dump quedó vacío");
    if (input.compress) await verifyGzip(filePath);
    return { filePath, bytes: size };
  } catch (err) {
    await rm(filePath, { force: true });
    throw err;
  }
}

/** Transform que elimina las cláusulas `DEFINER=...` respetando límites de línea. */
function definerStripper(): Transform {
  const decoder = new StringDecoder("utf8");
  const re = /\s*DEFINER\s*=\s*\S+/gi;
  let buf = "";
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      buf += decoder.write(chunk);
      const nl = buf.lastIndexOf("\n");
      if (nl < 0) return cb();
      const ready = buf.slice(0, nl + 1);
      buf = buf.slice(nl + 1);
      cb(null, ready.replace(re, ""));
    },
    flush(cb) {
      buf += decoder.end();
      cb(null, buf.replace(re, ""));
    },
  });
}

/** Lanza mysqldump y canaliza stdout → [limpieza DEFINER] → [gzip] → archivo. */
async function runMysqldump(
  args: string[],
  password: string,
  filePath: string,
  opts: { cleanDefiners: boolean; compress: boolean },
): Promise<void> {
  const child = spawn(env.MYSQLDUMP_PATH, args, {
    env: { ...process.env, MYSQL_PWD: password },
    timeout: env.BACKUP_TIMEOUT_MS,
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.on("data", (c: Buffer) => {
    if (stderr.length < 8000) stderr += c.toString();
  });

  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) =>
      reject(
        new Error(
          err.message.includes("ENOENT")
            ? `No se encontró mysqldump (${env.MYSQLDUMP_PATH}). Instálalo o ajusta MYSQLDUMP_PATH.`
            : err.message,
        ),
      ),
    );
  });

  const transforms: Transform[] = [];
  if (opts.cleanDefiners) transforms.push(definerStripper());
  if (opts.compress) transforms.push(createGzip({ level: GZIP_LEVEL }));

  const streams: (NodeJS.ReadableStream | NodeJS.ReadWriteStream | NodeJS.WritableStream)[] = [
    child.stdout!,
    ...transforms,
    createWriteStream(filePath),
  ];
  const [, code] = await Promise.all([pipeline(streams), closed]);

  if (code !== 0) {
    const detail = stderr.trim() || `mysqldump terminó con código ${code}`;
    throw new Error(password ? detail.split(password).join("***") : detail);
  }
}
