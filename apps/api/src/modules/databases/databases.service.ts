import type { DatabaseDto, DiscoveredDatabaseDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { decryptSecret } from "../../lib/crypto.js";
import * as serversRepo from "../servers/servers.repository.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import { getDiscoverer } from "./discovery/index.js";
import * as repo from "./databases.repository.js";

async function requireServer(serverId: string) {
  const server = await serversRepo.findById(serverId);
  if (!server) throw HttpError.notFound("Instancia no encontrada");
  return server;
}

/** Elimina cualquier rastro de la contraseña del mensaje de error del driver. */
function safeMessage(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (password) msg = msg.split(password).join("***");
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

export async function listDatabases(serverId: string): Promise<DatabaseDto[]> {
  await requireServer(serverId);
  return repo.listByServer(serverId);
}

/** Conecta a la instancia, lista sus BDs y marca las ya seleccionadas. */
export async function discover(serverId: string): Promise<DiscoveredDatabaseDto[]> {
  const server = await requireServer(serverId);
  if (!server.credentialId) {
    throw HttpError.badRequest("La instancia no tiene una credencial asignada");
  }
  const cred = await credsRepo.findById(server.credentialId);
  const enc = await credsRepo.getEncrypted(server.credentialId);
  if (!cred || !enc) throw HttpError.badRequest("La credencial asignada no existe");

  const password = decryptSecret(enc.passwordEncrypted);
  const discoverer = getDiscoverer(server.engine);

  let names: string[];
  try {
    names = await discoverer({
      host: server.host,
      port: server.port,
      user: cred.username,
      password,
      ssl: server.useSsl,
    });
  } catch (err) {
    throw HttpError.badRequest(`No se pudo conectar a la instancia: ${safeMessage(err, password)}`);
  }

  const saved = new Set(
    (await repo.listByServer(serverId)).map((d) => d.name.toLowerCase()),
  );
  return names.map((name) => ({ name, selected: saved.has(name.toLowerCase()) }));
}

export async function saveSelection(serverId: string, names: string[]): Promise<DatabaseDto[]> {
  await requireServer(serverId);
  // Normaliza: sin duplicados (ignorando mayúsculas) y sin vacíos.
  const seen = new Set<string>();
  const clean = names
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  await repo.setSelection(serverId, clean);
  return repo.listByServer(serverId);
}
