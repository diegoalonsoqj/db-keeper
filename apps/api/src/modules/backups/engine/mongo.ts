import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { env } from "../../../config/env.js";
import type { DumpInput, DumpResult } from "./types.js";
import { verifyGzip } from "./verify.js";
import { pipeStderrLines } from "./log-lines.js";

/**
 * Vuelca una BD MongoDB con `mongodump --archive` (un solo archivo), con `--gzip`
 * si se pide comprimir. Soporta **Atlas** (conexión `mongodb+srv://…&tls=true`,
 * como el script de referencia) y **Community** (`mongodb://host:port`).
 * Se restaura con `mongorestore --gzip --archive=<archivo>`.
 *
 * Nota: `mongodump` no tiene una variable de entorno para la contraseña (a
 * diferencia de `PGPASSWORD`/`MYSQL_PWD`), así que la credencial viaja en la URI;
 * se omite de cualquier log. Los argumentos van como array (sin shell).
 */
export async function dumpMongo(input: DumpInput): Promise<DumpResult> {
  const filePath = `${input.destPathNoExt}.archive${input.compress ? ".gz" : ""}`;
  const uri = buildUri(input);
  const args = [
    `--uri=${uri}`,
    `--archive=${filePath}`,
    ...(input.compress ? ["--gzip"] : []),
    ...(input.verbose ? ["--verbose"] : []),
  ];

  try {
    await runMongodump(args, input.password, input.onLog);
    const { size } = await stat(filePath);
    if (size === 0) throw new Error("El dump quedó vacío");
    if (input.compress) await verifyGzip(filePath);
    return { filePath, bytes: size };
  } catch (err) {
    await rm(filePath, { force: true });
    throw err;
  }
}

/** Construye la URI de conexión según sea Atlas (SRV) o un servidor estándar. */
function buildUri(input: DumpInput): string {
  const auth = `${encodeURIComponent(input.user)}:${encodeURIComponent(input.password)}`;
  const db = encodeURIComponent(input.dbName);
  if (input.mongoSrv) {
    return `mongodb+srv://${auth}@${input.host}/${db}?authSource=admin&retryWrites=true&w=majority&tls=true`;
  }
  const tls = input.ssl ? "&tls=true" : "";
  return `mongodb://${auth}@${input.host}:${input.port}/${db}?authSource=admin${tls}`;
}

function runMongodump(
  args: string[],
  password: string,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.MONGODUMP_PATH, args, {
      env: process.env,
      timeout: env.BACKUP_TIMEOUT_MS,
      windowsHide: true,
    });

    const getStderr = pipeStderrLines(child.stderr, (line) => onLog?.(line));

    child.on("error", (err) =>
      reject(
        new Error(
          err.message.includes("ENOENT")
            ? `No se encontró mongodump (${env.MONGODUMP_PATH}). Instálalo o ajusta MONGODUMP_PATH.`
            : err.message,
        ),
      ),
    );

    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      const detail = getStderr().trim() || (signal ? `terminado por señal ${signal}` : `código ${code}`);
      reject(new Error(password ? detail.split(password).join("***") : detail));
    });
  });
}
