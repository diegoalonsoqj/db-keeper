import type { StorageTargetDto, StorageType } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as repo from "./storage.repository.js";
import type { TargetFields } from "./storage.repository.js";

export async function listTargets(p: { limit: number; offset: number }) {
  return repo.listTargets(p);
}

export async function getTarget(id: string): Promise<StorageTargetDto> {
  const tgt = await repo.findById(id);
  if (!tgt) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  return tgt;
}

export interface TargetInput {
  type: StorageType;
  name: string;
  path?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  gcpServiceAccountId?: string | null;
  isActive: boolean;
}

/** Normaliza los campos según el tipo y valida lo obligatorio. */
function fieldsFromInput(data: TargetInput): TargetFields {
  if (data.type === "local") {
    const path = data.path?.trim();
    if (!path) throw HttpError.badRequest("La ruta es obligatoria para un destino local");
    return {
      type: "local",
      name: data.name,
      path,
      provider: null,
      bucket: null,
      prefix: null,
      gcpServiceAccountId: null,
      isActive: data.isActive,
    };
  }
  const bucket = data.bucket?.trim();
  if (!bucket) throw HttpError.badRequest("El nombre del bucket es obligatorio para un destino GCS");
  return {
    type: "gcs",
    name: data.name,
    path: null,
    provider: "gcs",
    bucket,
    prefix: data.prefix?.trim() || null,
    gcpServiceAccountId: data.gcpServiceAccountId ?? null,
    isActive: data.isActive,
  };
}

export async function createTarget(data: TargetInput): Promise<StorageTargetDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe un destino con ese nombre");
  }
  const id = await repo.insertTarget(fieldsFromInput(data));
  return getTarget(id);
}

export async function updateTarget(id: string, data: TargetInput): Promise<StorageTargetDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  if (data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe un destino con ese nombre");
  }
  await repo.updateTarget(id, fieldsFromInput(data));
  return getTarget(id);
}

export async function deleteTarget(id: string): Promise<void> {
  if (!(await repo.findById(id))) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  await repo.deleteTarget(id);
}

export async function setDefault(id: string): Promise<StorageTargetDto> {
  const tgt = await repo.findById(id);
  if (!tgt) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  await repo.setDefault(id, tgt.type);
  return getTarget(id);
}
