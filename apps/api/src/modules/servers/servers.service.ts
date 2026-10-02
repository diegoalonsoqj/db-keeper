import type { CloudSqlCheckDto, DbEngine, ServerDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { getInstance } from "../../lib/cloudsql.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import { assertAssignable, resolveGcpServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
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
  host: string | null;
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

/**
 * La credencial de nube para la API de Cloud SQL debe existir, ser de GCP y estar
 * activa. Solo se valida si cambia: editar otros campos de una instancia cuya cuenta
 * se desactivó no debe bloquearse (el backup sí avisará al ejecutar).
 */
async function assertCloudCredential(id: string | null | undefined, current: string | null = null): Promise<void> {
  if (!id || id === current) return;
  await assertAssignable(id, "gcp");
}

/** El host solo puede faltar en Cloud SQL: el resto de métodos se conecta a la BD. */
function assertHost(host: string | null, isCloudSql: boolean): void {
  if (!host && !isCloudSql) throw HttpError.badRequest("Indica el host o IP de la instancia");
}

export async function createServer(data: ServerData): Promise<ServerDto> {
  assertHost(data.host, data.isCloudSql);
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
  assertHost(data.host !== undefined ? data.host : existing.host, data.isCloudSql ?? existing.isCloudSql);

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe una instancia con ese nombre");
  }
  await assertCredentialExists(data.credentialId);
  await assertCloudCredential(data.cloudCredentialId, existing.cloudCredentialId);
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
