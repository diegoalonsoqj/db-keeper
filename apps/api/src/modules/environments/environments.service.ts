import type { EnvironmentDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as repo from "./environments.repository.js";
import type { EnvironmentFields } from "./environments.repository.js";

export async function listEnvironments(p: { limit: number; offset: number }) {
  return repo.listEnvironments(p);
}

async function ensureNameFree(name: string, exceptId?: string): Promise<void> {
  const existing = await repo.findByName(name);
  if (existing && existing.id !== exceptId) {
    throw HttpError.badRequest("Ya existe un ambiente con ese nombre");
  }
}

export async function createEnvironment(data: EnvironmentFields): Promise<EnvironmentDto> {
  await ensureNameFree(data.name);
  const id = await repo.insertEnvironment(data);
  const created = await repo.findById(id);
  if (!created) throw HttpError.notFound("Ambiente no encontrado");
  return created;
}

export async function updateEnvironment(
  id: string,
  data: Partial<EnvironmentFields>,
): Promise<EnvironmentDto> {
  if (!(await repo.findById(id))) throw HttpError.notFound("Ambiente no encontrado");
  if (data.name) await ensureNameFree(data.name, id);
  await repo.updateEnvironment(id, data);
  const updated = await repo.findById(id);
  if (!updated) throw HttpError.notFound("Ambiente no encontrado");
  return updated;
}

export async function deleteEnvironment(id: string): Promise<void> {
  const env = await repo.findById(id);
  if (!env) throw HttpError.notFound("Ambiente no encontrado");
  // No hay FK (la instancia guarda el nombre como texto): solo avisamos si está en uso.
  const inUse = await repo.countServersUsing(env.name);
  if (inUse > 0) {
    throw HttpError.badRequest(
      `No se puede eliminar: ${inUse} instancia(s) usan el ambiente «${env.name}»`,
    );
  }
  await repo.deleteEnvironment(id);
}
