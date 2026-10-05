import type { DiscoveredDatabase, PgEventTrigger, PgExtension } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { decryptSecret } from "../../lib/crypto.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import { listDatabases } from "../../lib/cloudsql.js";
import { resolveGcpServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
import { getDiscoverer } from "./discovery/index.js";
import { listPostgresEventTriggers, listPostgresExtensions, listPostgresSchemas } from "./discovery/postgres.js";
import type { ConnInfo } from "./discovery/types.js";

/** Elimina cualquier rastro de la contraseña del mensaje de error del driver. */
function safeMessage(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (password) msg = msg.split(password).join("***");
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/**
 * Datos de conexión a la instancia: usa la credencial recibida (override del
 * evento) y, si no se pasa, la asignada a la instancia. Así se puede descubrir una
 * instancia sin credencial base usando una credencial existente.
 */
async function resolveConn(serverId: string, credentialId?: string | null) {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.notFound("Instancia no encontrada");
  if (!server.host) {
    throw HttpError.badRequest("La instancia no tiene host/IP: lista sus BDs por la API de Cloud SQL");
  }
  const effectiveCredId = credentialId ?? server.credentialId;
  if (!effectiveCredId) {
    throw HttpError.badRequest("No hay credencial: asígnala a la instancia o elígela en el evento");
  }
  const cred = await credsRepo.findById(effectiveCredId);
  const enc = await credsRepo.getEncrypted(effectiveCredId);
  if (!cred || !enc) throw HttpError.badRequest("La credencial indicada no existe");
  const password = decryptSecret(enc.passwordEncrypted);
  const conn: ConnInfo = {
    host: server.host,
    port: server.port,
    user: cred.username,
    password,
    ssl: server.useSsl,
    mongoSrv: server.mongoSrv,
    connOptions: server.connOptions,
  };
  return { engine: server.engine, conn };
}

/** Conecta a la instancia y lista sus BDs reales. */
export async function discover(serverId: string, credentialId?: string | null): Promise<DiscoveredDatabase[]> {
  const { engine, conn } = await resolveConn(serverId, credentialId);
  try {
    return await getDiscoverer(engine)(conn);
  } catch (err) {
    throw HttpError.badRequest(`No se pudo conectar a la instancia: ${safeMessage(err, conn.password)}`);
  }
}

/** Esquemas de una BD de PostgreSQL (para elegir cuáles excluir del dump). */
export async function listSchemas(serverId: string, dbName: string, credentialId?: string | null): Promise<string[]> {
  const { engine, conn } = await resolveConn(serverId, credentialId);
  if (engine !== "postgres") throw HttpError.badRequest("Los esquemas solo aplican a PostgreSQL");
  try {
    return await listPostgresSchemas(conn, dbName);
  } catch (err) {
    throw HttpError.badRequest(`No se pudieron listar los esquemas de ${dbName}: ${safeMessage(err, conn.password)}`);
  }
}

/** Extensiones instaladas en una BD de PostgreSQL (para elegir cuáles excluir del dump). */
export async function listExtensions(
  serverId: string,
  dbName: string,
  credentialId?: string | null,
): Promise<PgExtension[]> {
  const { engine, conn } = await resolveConn(serverId, credentialId);
  if (engine !== "postgres") throw HttpError.badRequest("Las extensiones solo aplican a PostgreSQL");
  try {
    return await listPostgresExtensions(conn, dbName);
  } catch (err) {
    throw HttpError.badRequest(`No se pudieron listar las extensiones de ${dbName}: ${safeMessage(err, conn.password)}`);
  }
}

/** Event triggers de una BD de PostgreSQL (para elegir cuáles excluir del dump). */
export async function listEventTriggers(
  serverId: string,
  dbName: string,
  credentialId?: string | null,
): Promise<PgEventTrigger[]> {
  const { engine, conn } = await resolveConn(serverId, credentialId);
  if (engine !== "postgres") throw HttpError.badRequest("Los event triggers solo aplican a PostgreSQL");
  try {
    return await listPostgresEventTriggers(conn, dbName);
  } catch (err) {
    throw HttpError.badRequest(
      `No se pudieron listar los event triggers de ${dbName}: ${safeMessage(err, conn.password)}`,
    );
  }
}

/**
 * Lista las BDs de una instancia Cloud SQL con la API de Cloud SQL Admin, sin
 * conectarse a ella ni usar credencial de BD (para el método `cloudsql_export`). La
 * API no informa el tamaño de cada BD: va como null.
 */
export async function discoverCloudSql(serverId: string): Promise<DiscoveredDatabase[]> {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.notFound("Instancia no encontrada");
  if (!server.isCloudSql || !server.gcpProject || !server.gcpInstance) {
    throw HttpError.badRequest("La instancia no está configurada como Cloud SQL (proyecto e instancia GCP)");
  }
  try {
    const names = await listDatabases({
      serviceAccountJson: await resolveGcpServiceAccountJson(server.cloudCredentialId),
      project: server.gcpProject,
      instance: server.gcpInstance,
    });
    return names.map((name) => ({ name, bytes: null }));
  } catch (err) {
    throw HttpError.badRequest(err instanceof Error ? err.message : String(err));
  }
}
