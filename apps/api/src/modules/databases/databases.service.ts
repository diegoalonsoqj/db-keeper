import { HttpError } from "../../lib/http-error.js";
import { decryptSecret } from "../../lib/crypto.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import { getDiscoverer } from "./discovery/index.js";

/** Elimina cualquier rastro de la contraseña del mensaje de error del driver. */
function safeMessage(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (password) msg = msg.split(password).join("***");
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/** Conecta a la instancia con su credencial del catálogo y lista sus BDs reales. */
export async function discover(serverId: string): Promise<string[]> {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.notFound("Instancia no encontrada");
  if (!server.credentialId) {
    throw HttpError.badRequest("La instancia no tiene una credencial asignada");
  }
  const cred = await credsRepo.findById(server.credentialId);
  const enc = await credsRepo.getEncrypted(server.credentialId);
  if (!cred || !enc) throw HttpError.badRequest("La credencial asignada no existe");

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
