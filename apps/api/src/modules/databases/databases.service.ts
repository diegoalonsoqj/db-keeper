import { HttpError } from "../../lib/http-error.js";
import { decryptSecret } from "../../lib/crypto.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import { listDatabases } from "../../lib/cloudsql.js";
import { resolveGcpServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
import { getDiscoverer } from "./discovery/index.js";

/** Elimina cualquier rastro de la contraseña del mensaje de error del driver. */
function safeMessage(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (password) msg = msg.split(password).join("***");
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/**
 * Conecta a la instancia y lista sus BDs reales. Usa la credencial recibida
 * (override del evento) y, si no se pasa, la asignada a la instancia. Así se puede
 * descubrir una instancia sin credencial base usando una credencial existente.
 */
export async function discover(serverId: string, credentialId?: string | null): Promise<string[]> {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.notFound("Instancia no encontrada");
  const effectiveCredId = credentialId ?? server.credentialId;
  if (!effectiveCredId) {
    throw HttpError.badRequest("No hay credencial: asígnala a la instancia o elígela en el evento");
  }
  const cred = await credsRepo.findById(effectiveCredId);
  const enc = await credsRepo.getEncrypted(effectiveCredId);
  if (!cred || !enc) throw HttpError.badRequest("La credencial indicada no existe");

  const password = decryptSecret(enc.passwordEncrypted);
  const discoverer = getDiscoverer(server.engine);
  try {
    return await discoverer({
      host: server.host,
      port: server.port,
      user: cred.username,
      password,
      ssl: server.useSsl,
    });
  } catch (err) {
    throw HttpError.badRequest(`No se pudo conectar a la instancia: ${safeMessage(err, password)}`);
  }
}

/**
 * Lista las BDs de una instancia Cloud SQL con la API de Cloud SQL Admin, sin
 * conectarse a ella ni usar credencial de BD (para el método `cloudsql_export`).
 */
export async function discoverCloudSql(serverId: string): Promise<string[]> {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.notFound("Instancia no encontrada");
  if (!server.isCloudSql || !server.gcpProject || !server.gcpInstance) {
    throw HttpError.badRequest("La instancia no está configurada como Cloud SQL (proyecto e instancia GCP)");
  }
  try {
    return await listDatabases({
      serviceAccountJson: await resolveGcpServiceAccountJson(server.cloudCredentialId),
      project: server.gcpProject,
      instance: server.gcpInstance,
    });
  } catch (err) {
    throw HttpError.badRequest(err instanceof Error ? err.message : String(err));
  }
}
