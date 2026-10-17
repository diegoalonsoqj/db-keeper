import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { APPLICATION_NAME } from "./instance.js";

/**
 * Liderazgo entre instancias que comparten la BD de metadatos. El trabajo en segundo
 * plano (recuperación de corridas, cola, scheduler, retención, GC de discos) asume un
 * solo proceso: dos a la vez se reparten las programaciones, ejecutan la cola del otro
 * con sus propios binarios y cierran como "interrumpidas" las corridas ajenas.
 *
 * Candado de sesión (`pg_try_advisory_lock`) en una conexión dedicada, fuera del pool:
 * vive mientras viva esa conexión. Las instancias sin el candado solo sirven la API.
 */

/** Clave del candado ("DBKP" en ASCII). */
const LOCK_KEY = 0x44424b50;
const RETRY_MS = 30_000;
const HEALTH_MS = 30_000;

let client: pg.Client | null = null;
let stopped = false;

/** Canales LISTEN de la líder (`pg_notify` desde cualquier instancia → handler). */
const listeners = new Map<string, () => void>();

/** LISTEN de todos los canales registrados en la conexión del candado. */
async function subscribe(c: pg.Client): Promise<void> {
  for (const channel of listeners.keys()) await c.query(`LISTEN ${channel}`);
}

async function connect(): Promise<pg.Client> {
  const c = new pg.Client({
    connectionString: env.DATABASE_URL,
    application_name: `${APPLICATION_NAME} (leader)`.slice(0, 63),
    keepAlive: true,
    connectionTimeoutMillis: 5_000,
  });
  // Sin listener, un error de la conexión dedicada tumbaría el proceso.
  c.on("error", (err) => logger.error({ err }, "Error en la conexión del candado de líder"));
  await c.connect();
  return c;
}

async function tryAcquire(): Promise<boolean> {
  const c = await connect();
  try {
    const { rows } = await c.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (rows[0]?.ok) {
      c.on("notification", (msg) => listeners.get(msg.channel)?.());
      await subscribe(c);
      client = c;
      return true;
    }
  } catch (err) {
    await c.end().catch(() => {});
    throw err;
  }
  await c.end().catch(() => {});
  return false;
}

/** Quién tiene el candado (para el log de la instancia que queda en espera). */
async function describeHolder(): Promise<string> {
  const c = await connect();
  try {
    const { rows } = await c.query<{ app: string | null; addr: string | null }>(
      `SELECT a.application_name AS app, host(a.client_addr) AS addr
       FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND l.granted AND l.objid = $1 AND l.objsubid = 1
       LIMIT 1`,
      [LOCK_KEY],
    );
    return rows[0] ? `${rows[0].app || "?"} (${rows[0].addr ?? "local"})` : "desconocido";
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * Comprueba la conexión del candado. Si se cayó (red, reinicio de PostgreSQL), el
 * candado se perdió: se reintenta al instante. Si otra instancia lo tomó mientras
 * tanto, se sale para que el gestor de procesos reinicie esta como seguidora: seguir
 * corriendo la cola/scheduler en paralelo es justo lo que el candado evita.
 */
async function healthCheck(): Promise<void> {
  if (stopped || !client) return;
  try {
    await client.query("SELECT 1");
    return;
  } catch (err) {
    logger.error({ err }, "Se perdió la conexión del candado de líder; reintentando");
  }
  await client.end().catch(() => {});
  client = null;
  try {
    if (await tryAcquire()) {
      logger.info("Candado de líder recuperado.");
      return;
    }
    logger.fatal(
      { holder: await describeHolder().catch(() => "desconocido") },
      "Otra instancia tomó el candado de líder; la API se reinicia como seguidora",
    );
  } catch (err) {
    logger.fatal({ err }, "No se pudo recuperar el candado de líder; la API se reinicia");
  }
  process.exit(1);
}

/**
 * Ejecuta `onLeader` una sola vez, cuando esta instancia obtiene el candado. Mientras
 * otra lo tenga, reintenta cada 30 s (toma el relevo si la líder se apaga).
 */
export function runAsLeader(onLeader: () => void): void {
  const attempt = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (await tryAcquire()) {
        logger.info("Instancia líder: corre la cola de backups y el scheduler.");
        setInterval(() => void healthCheck(), HEALTH_MS).unref();
        onLeader();
        return;
      }
      const holder = await describeHolder().catch(() => "desconocido");
      logger.warn(
        { holder },
        "Otra instancia de DBKeeper tiene el candado de líder: esta solo sirve la API (no ejecuta backups ni programaciones)",
      );
    } catch (err) {
      logger.error({ err }, "No se pudo intentar el candado de líder");
    }
    setTimeout(() => void attempt(), RETRY_MS).unref();
  };
  void attempt();
}

/**
 * Mientras esta instancia sea la líder, llama a `handler` cada vez que cualquier
 * instancia haga `pg_notify(channel)`. Usa la conexión del candado (sobrevive a la
 * reconexión del healthCheck). `channel`: identificador SQL simple.
 */
export async function listenAsLeader(channel: string, handler: () => void): Promise<void> {
  if (!/^[a-z_]+$/.test(channel)) throw new Error(`Canal LISTEN inválido: ${channel}`);
  listeners.set(channel, handler);
  if (client) await client.query(`LISTEN ${channel}`);
}

/** Libera el candado al apagar (si no, PostgreSQL lo suelta al cerrar la conexión). */
export async function releaseLeadership(): Promise<void> {
  stopped = true;
  if (!client) return;
  await client.end().catch(() => {});
  client = null;
}
