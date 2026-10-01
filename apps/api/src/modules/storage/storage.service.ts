import type { CloudProvider, StorageTargetDto, StorageType } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { assertAssignable } from "../cloud-credentials/cloud-credentials.service.js";
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
  provider?: CloudProvider | null;
  bucket?: string | null;
  prefix?: string | null;
  cloudCredentialId?: string | null;
  isActive: boolean;
}

// Nombre de bucket GCS: minúsculas, dígitos, '-', '_' y '.', empieza/termina alfanumérico.
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** Quita barras sobrantes y dobles: " /a//b/ " → "a/b"; vacío → null. */
function cleanPath(p: string | null | undefined): string | null {
  const s = (p ?? "").trim().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  return s || null;
}

/**
 * Separa bucket y prefijo aunque se escriban juntos: "gs://b/x/y" o "b/x/y" en el
 * campo bucket → bucket "b", prefijo "x/y" (+ el prefijo indicado, si lo hay).
 */
export function normalizeBucket(
  bucketIn: string,
  prefixIn: string | null | undefined,
): { bucket: string; prefix: string | null } {
  const raw = cleanPath(bucketIn.trim().replace(/^gs:\/\//i, "")) ?? "";
  const [bucket = "", ...rest] = raw.split("/");
  const prefix = cleanPath([rest.join("/"), prefixIn ?? ""].filter(Boolean).join("/"));
  return { bucket, prefix };
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
      cloudCredentialId: null,
      isActive: data.isActive,
    };
  }
  // type === "bucket"
  if (!data.provider) throw HttpError.badRequest("El proveedor de nube es obligatorio para un bucket");
  const { bucket, prefix } = normalizeBucket(data.bucket ?? "", data.prefix);
  if (!bucket) throw HttpError.badRequest("El nombre del bucket es obligatorio");
  if (!BUCKET_RE.test(bucket)) {
    throw HttpError.badRequest(`Nombre de bucket inválido: '${bucket}' (solo minúsculas, números, '-', '_' y '.')`);
  }
  return {
    type: "bucket",
    name: data.name,
    path: null,
    provider: data.provider,
    bucket,
    prefix,
    cloudCredentialId: data.cloudCredentialId ?? null,
    isActive: data.isActive,
  };
}

export async function createTarget(data: TargetInput): Promise<StorageTargetDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe un destino con ese nombre");
  }
  const fields = fieldsFromInput(data);
  if (fields.cloudCredentialId && fields.provider) await assertAssignable(fields.cloudCredentialId, fields.provider);
  const id = await repo.insertTarget(fields);
  return getTarget(id);
}

export async function updateTarget(id: string, data: TargetInput): Promise<StorageTargetDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  if (data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe un destino con ese nombre");
  }
  const fields = fieldsFromInput(data);
  // La cuenta solo se valida si cambia (editar un destino con cuenta ya inactiva no se bloquea).
  if (fields.cloudCredentialId && fields.provider && fields.cloudCredentialId !== existing.cloudCredentialId) {
    await assertAssignable(fields.cloudCredentialId, fields.provider);
  }
  await repo.updateTarget(id, fields);
  return getTarget(id);
}

export async function deleteTarget(id: string): Promise<void> {
  if (!(await repo.findById(id))) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  await repo.deleteTarget(id);
}

export async function setDefault(id: string): Promise<StorageTargetDto> {
  const tgt = await repo.findById(id);
  if (!tgt) throw HttpError.notFound("Destino de almacenamiento no encontrado");
  if (!tgt.isActive) throw HttpError.badRequest("Un destino inactivo no puede ser el predeterminado");
  await repo.setDefault(id, tgt.type);
  return getTarget(id);
}
