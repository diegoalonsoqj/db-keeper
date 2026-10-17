import type { GcpProjectDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as repo from "./gcp-projects.repository.js";
import type { GcpProjectFields } from "./gcp-projects.repository.js";

export const listGcpProjects = (p: { limit: number; offset: number }) => repo.listGcpProjects(p);

async function ensureProjectIdFree(projectId: string, exceptId?: string): Promise<void> {
  const existing = await repo.findByProjectId(projectId);
  if (existing && existing.id !== exceptId) throw HttpError.badRequest("Ya existe un proyecto con ese ID");
}

export async function createGcpProject(data: GcpProjectFields): Promise<GcpProjectDto> {
  await ensureProjectIdFree(data.projectId);
  const created = await repo.findById(await repo.insertGcpProject(data));
  if (!created) throw HttpError.notFound("Proyecto no encontrado");
  return created;
}

export async function updateGcpProject(id: string, data: Partial<GcpProjectFields>): Promise<GcpProjectDto> {
  const current = await repo.findById(id);
  if (!current) throw HttpError.notFound("Proyecto no encontrado");
  if (data.projectId && data.projectId.toLowerCase() !== current.projectId.toLowerCase()) {
    await ensureProjectIdFree(data.projectId, id);
    // Sin FK: cambiar el ID dejaría a las instancias apuntando a un proyecto que ya no está en el catálogo.
    const inUse = await repo.countServersUsing(current.projectId);
    if (inUse > 0) {
      throw HttpError.badRequest(`No se puede cambiar el ID: ${inUse} instancia(s) usan el proyecto «${current.projectId}»`);
    }
  }
  await repo.updateGcpProject(id, data);
  const updated = await repo.findById(id);
  if (!updated) throw HttpError.notFound("Proyecto no encontrado");
  return updated;
}

export async function deleteGcpProject(id: string): Promise<void> {
  const p = await repo.findById(id);
  if (!p) throw HttpError.notFound("Proyecto no encontrado");
  const inUse = await repo.countServersUsing(p.projectId);
  if (inUse > 0) {
    throw HttpError.badRequest(`No se puede eliminar: ${inUse} instancia(s) usan el proyecto «${p.projectId}»`);
  }
  await repo.deleteGcpProject(id);
}
