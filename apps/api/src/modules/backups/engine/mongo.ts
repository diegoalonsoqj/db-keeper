import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { env } from "../../../config/env.js";
import { buildMongoUri } from "../../../lib/mongo-uri.js";
import { isWireVersionTooLow } from "../../../lib/mongo-compat.js";
import { listMongoCollections, withMongoClient } from "../../../lib/mongo-client.js";
import { matchCollectionRule } from "@dbkeeper/shared";
import type { DumpInput, DumpResult } from "./types.js";
import { verifyGzip } from "./verify.js";
import { pipeStderrLines, describeDumpExit } from "./log-lines.js";
import { lowerPriority } from "./priority.js";
import { superviseDump, type DumpLimits } from "./supervise.js";
import { maskSecret } from "../../../lib/mask-secret.js";
import { removeSecretFile, writeSecretFile } from "../../../lib/secret-file.js";

/**
 * Vuelca una BD MongoDB con `mongodump --archive` (un solo archivo), con `--gzip`
 * si se pide comprimir. Soporta **Atlas** (conexión `mongodb+srv://…&tls=true`,
 * como el script de referencia) y **Community** (`mongodb://host:port`).
 * Se restaura con `mongorestore --gzip --archive=<archivo>`.
 *
 * Nota: `mongodump` no tiene una variable de entorno para la contraseña (a
 * diferencia de `PGPASSWORD`/`MYSQL_PWD`), así que la credencial viaja en la URI.
 * Por defecto la URI va en un archivo `--config` temporal (Database Tools ≥ 100.3.0)
 * y no en la línea de comandos, donde se vería con `ps`; ver `runWithUri`. Se omite
 * de cualquier log. Los argumentos van como array (sin shell).
 */
export async function dumpMongo(input: DumpInput): Promise<DumpResult> {
  const filePath = `${input.destPathNoExt}.archive${input.compress ? ".gz" : ""}`;
  const uri = buildUri(input);
  const excluded = await resolveExcludedCollections(input);
  const args = [
    `--archive=${filePath}`,
    ...(input.compress ? ["--gzip"] : []),
    ...(input.verbose ? ["--verbose"] : []),
    // La BD va en la URI: mongodump la toma como --db, que --excludeCollection exige.
    ...excluded.map((c) => `--excludeCollection=${c}`),
  ];

  try {
    try {
      await runWithUri(MAIN_BIN, uri, args, input, filePath);
    } catch (err) {
      if (!isWireVersionTooLow(err)) throw err;
      // Servidor < 4.2 (p. ej. 3.6): las Database Tools recientes ya no lo soportan.
      const legacy = env.MONGODUMP_LEGACY_PATH;
      if (!legacy) {
        throw new Error(
          `${(err as Error).message}\nEl servidor es anterior a MongoDB 4.2: instala unas Database Tools compatibles (p. ej. 100.10.0) y configura MONGODUMP_LEGACY_PATH.`,
        );
      }
      input.onLog?.(`Servidor anterior a MongoDB 4.2: reintentando con ${legacy}`);
      await rm(filePath, { force: true });
      await runWithUri({ path: legacy, envVar: "MONGODUMP_LEGACY_PATH" }, uri, args, input, filePath);
    }
    const { size } = await stat(filePath);
    if (size === 0) throw new Error("El dump quedó vacío");
    if (input.compress) await verifyGzip(filePath);
    return { filePath, bytes: size };
  } catch (err) {
    await rm(filePath, { force: true });
    throw err;
  }
}

/**
 * Corre mongodump con la URI en un `--config` temporal (600, carpeta privada) que se
 * borra al terminar; mongodump lo lee solo al arrancar, así que la duración del dump
 * no importa. Si el binario no conoce `--config` (Database Tools < 100.3.0) o el
 * ajuste está desactivado, la pasa con `--uri` como antes.
 */
async function runWithUri(bin: MongodumpBin, uri: string, args: string[], input: DumpInput, filePath: string): Promise<void> {
  const run = (first: string) => runMongodump(bin, [first, ...args], input.password, filePath, input.limits, input.onLog);
  if (input.mongoPasswordViaConfig === false) return run(`--uri=${uri}`);
  const config = await writeSecretFile(mongodumpConfig(uri), ".yaml");
  try {
    await run(`--config=${config}`);
  } catch (err) {
    if (!isUnknownConfigOption(err)) throw err;
    input.onLog?.(
      `${bin.path} no admite --config (Database Tools anteriores a 100.3.0): se reintenta con --uri, ` +
        `y la contraseña queda visible en la lista de procesos mientras dure el dump. Actualiza ${bin.envVar}.`,
    );
    await rm(filePath, { force: true });
    await run(`--uri=${uri}`);
  } finally {
    await removeSecretFile(config);
  }
}

/** YAML de `--config` con la URI (JSON es YAML válido: queda bien escapada). */
export function mongodumpConfig(uri: string): string {
  return `uri: ${JSON.stringify(uri)}\n`;
}

/** Binario que no reconoce `--config`: "error parsing command line options: unknown option \"config\"". */
export function isUnknownConfigOption(err: unknown): boolean {
  return /unknown option\W+config\b/i.test(err instanceof Error ? err.message : String(err));
}

/** URI de conexión (Atlas SRV o estándar) con las opciones de la instancia. */
function buildUri(input: DumpInput, extra?: Record<string, string>): string {
  return buildMongoUri({ ...input, srv: input.mongoSrv === true, options: input.connOptions, extra });
}

/** Timeout para listar las colecciones antes del dump (ms). */
const LIST_TIMEOUT_MS = "15000";

/**
 * Colecciones de la BD que excluyen las reglas del evento, resueltas contra las que
 * existen ahora (mongodump solo excluye por nombre exacto o prefijo). Deja en el log
 * cuáles y por qué regla. Lanza si no se pueden listar (no se respalda ignorando la
 * exclusión pedida) o si las reglas excluyen todas (sería un backup vacío).
 */
async function resolveExcludedCollections(input: DumpInput): Promise<string[]> {
  const ex = input.excludeCollections;
  if (!ex || ex.rules.length === 0) return [];
  let collections: string[];
  try {
    const listUri = buildUri(input, { serverSelectionTimeoutMS: LIST_TIMEOUT_MS, connectTimeoutMS: LIST_TIMEOUT_MS });
    collections = (await withMongoClient(listUri, (c) => listMongoCollections(c, input.dbName))).map((c) => c.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudieron listar las colecciones para aplicar las exclusiones: ${maskSecret(msg, input.password)}`);
  }
  const byRule = new Map<string, string[]>();
  for (const coll of collections) {
    const rule = matchCollectionRule(ex.rules, input.dbName, coll, ex.databases, ex.caseSensitive);
    if (rule) byRule.set(rule, [...(byRule.get(rule) ?? []), coll]);
  }
  const excluded = [...byRule.values()].flat();
  if (excluded.length === 0) {
    input.onLog?.("Colecciones excluidas: ninguna coincide con las reglas del evento.");
    return [];
  }
  if (excluded.length === collections.length) {
    throw new Error(`Las reglas de exclusión excluyen las ${collections.length} colecciones de ${input.dbName}: no se genera un backup vacío.`);
  }
  const mode = ex.caseSensitive ? "distinguiendo mayúsculas" : "sin distinguir mayúsculas";
  input.onLog?.(`Colecciones excluidas (${excluded.length} de ${collections.length}, ${mode}):`);
  for (const [rule, colls] of byRule) input.onLog?.(`  ${rule} → ${colls.join(", ")}`);
  return excluded;
}

interface MongodumpBin {
  path: string;
  /** Variable de entorno que lo configura (para el mensaje si no se encuentra). */
  envVar: string;
}

const MAIN_BIN: MongodumpBin = { path: env.MONGODUMP_PATH, envVar: "MONGODUMP_PATH" };

function runMongodump(
  bin: MongodumpBin,
  args: string[],
  password: string,
  filePath: string,
  limits: DumpLimits,
  onLog?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin.path, args, {
      env: process.env,
      windowsHide: true,
    });
    lowerPriority(child);
    const sup = superviseDump(child, filePath, limits);

    const getStderr = pipeStderrLines(child.stderr, (line) => {
      sup.activity();
      onLog?.(line);
    });

    child.on("error", (err) => {
      sup.stop();
      reject(
        new Error(
          err.message.includes("ENOENT")
            ? `No se encontró mongodump (${bin.path}). Instálalo o ajusta ${bin.envVar}.`
            : err.message,
        ),
      );
    });

    child.on("close", (code, signal) => {
      sup.stop();
      if (code === 0) return resolve();
      const detail = describeDumpExit({
        tool: "mongodump",
        code,
        signal,
        stopReason: sup.reason(),
        limits,
        stderr: getStderr(),
      });
      reject(new Error(maskSecret(detail, password)));
    });
  });
}
