import type { DbEngine, ServerDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as credsRepo from "../credentials/credentials.repository.js";
import * as repo from "./servers.repository.js";
import type { ServerFields } from "./servers.repository.js";

export async function listServers(): Promise<ServerDto[]> {
  return repo.listServers();
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
  notes: string | null;
  credentialId: string | null;
}

async function assertCredentialExists(credentialId: string | null | undefined): Promise<void> {
  if (credentialId && !(await credsRepo.findById(credentialId))) {
    throw HttpError.badRequest("La credencial seleccionada no existe");
  }
}

export async function createServer(data: ServerData): Promise<ServerDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe una instancia con ese nombre");
  }
  await assertCredentialExists(data.credentialId);
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
  await repo.updateServerFields(id, data as Partial<ServerFields>);
  return getServer(id);
}

export async function deleteServer(id: string): Promise<void> {
  const s = await repo.findById(id);
  if (!s) throw HttpError.notFound("Instancia no encontrada");
  await repo.deleteServer(id);
}
