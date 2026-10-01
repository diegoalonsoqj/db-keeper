import type { CloudSqlCheckDto, DbEngine, ServerDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { getInstance } from "../../lib/cloudsql.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import * as cloudRepo from "../cloud-credentials/cloud-credentials.repository.js";
import { resolveGcpServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
import * as repo from "./servers.repository.js";
import type { ServerFields } from "./servers.repository.js";

export async function listServers(p: { limit: number; offset: number }) {
  return repo.listServers(p);
}

export async function getServer(id: string): Promise<ServerDto> {
  const s = await repo.findById(id);
  if (!s) throw HttpError.notFound("Instancia no encontrada");
  return s;
}

export interface ServerData {
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  environment: string | null;
  useSsl: boolean;
  isCloudSql: boolean;
  gcpProject: string | null;
  gcpInstance: string | null;
  cloudCredentialId: string | null;
  notes: string | null;
  credentialId: string | null;
}

async function assertCredentialExists(credentialId: string | null | undefined): Promise<void> {
  if (credentialId && !(await credsRepo.findById(credentialId))) {
    throw HttpError.badRequest("La credencial seleccionada no existe");
  }
}

/** La credencial de nube para la API de Cloud SQL debe existir y ser de GCP. */
async function assertCloudCredential(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const c = await cloudRepo.findById(id);
  if (!c) throw HttpError.badRequest("La cuenta de servicio seleccionada no existe");
  if (c.provider !== "gcp") throw HttpError.badRequest("La API de Cloud SQL requiere una cuenta de servicio de GCP");
}

export async function createServer(data: ServerData): Promise<ServerDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe una instancia con ese nombre");
  }
  await assertCredentialExists(data.credentialId);
  await assertCloudCredential(data.cloudCredentialId);
  const id = await repo.insertServer(data as ServerFields);
  return getServer(id);
}

export async function updateServer(id: string, data: Partial<ServerData>): Promise<ServerDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Instancia no encontrada");

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe una instancia con ese nombre");
  }
  await assertCredentialExists(data.credentialId);
  await assertCloudCredential(data.cloudCredentialId);
  await repo.updateServerFields(id, data as Partial<ServerFields>);
  return getServer(id);
}

export async function deleteServer(id: string): Promise<void> {
  const s = await repo.findById(id);
  if (!s) throw HttpError.notFound("Instancia no encontrada");
  await repo.deleteServer(id);
}

/**
 * "Probar Cloud SQL": lee la instancia desde la API de Cloud SQL Admin con la
 * credencial de nube de la instancia. Valida proyecto, nombre y permisos, y devuelve
 * la service account propia de la instancia (la que debe poder escribir en el bucket).
 */
export async function checkCloudSql(id: string): Promise<CloudSqlCheckDto> {
  const s = await getServer(id);
  if (!s.isCloudSql || !s.gcpProject || !s.gcpInstance) {
    throw HttpError.badRequest("La instancia no está configurada como Cloud SQL (proyecto e instancia GCP)");
  }
  try {
    return await getInstance({
      serviceAccountJson: await resolveGcpServiceAccountJson(s.cloudCredentialId),
      project: s.gcpProject,
      instance: s.gcpInstance,
    });
  } catch (err) {
    throw HttpError.badRequest(err instanceof Error ? err.message : String(err));
  }
}
