import type { CloudCredentialDto, CloudProvider } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { encryptSecret } from "../../lib/crypto.js";
import * as repo from "./cloud-credentials.repository.js";

export async function listCredentials(p: { limit: number; offset: number }) {
  return repo.list(p);
}

export async function getCredential(id: string): Promise<CloudCredentialDto> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.notFound("Cuenta de servicio no encontrada");
  return c;
}

/**
 * Valida el secreto según el proveedor y extrae metadatos no secretos.
 * De momento solo GCP está implementado (JSON de service account).
 */
function buildSecret(provider: CloudProvider, secret: string): { metadata: Record<string, unknown> } {
  if (provider !== "gcp") {
    throw HttpError.badRequest(`El proveedor '${provider}' aún no está implementado`);
  }
  let json: unknown;
  try {
    json = JSON.parse(secret);
  } catch {
    throw HttpError.badRequest("La clave no es un JSON válido");
  }
  if (typeof json !== "object" || json === null) {
    throw HttpError.badRequest("La clave debe ser el JSON de la cuenta de servicio");
  }
  const o = json as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  if (typeof o.client_email === "string") metadata.clientEmail = o.client_email;
  if (typeof o.project_id === "string") metadata.projectId = o.project_id;
  return { metadata };
}

export interface CredentialInput {
  name: string;
  provider: CloudProvider;
  secret?: string;
  isActive: boolean;
}

export async function createCredential(data: CredentialInput): Promise<CloudCredentialDto> {
  if (!data.secret) throw HttpError.badRequest("La clave es obligatoria");
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe una cuenta con ese nombre");
  }
  const { metadata } = buildSecret(data.provider, data.secret);
  const id = await repo.insert({
    name: data.name,
    provider: data.provider,
    metadata,
    secretEncrypted: encryptSecret(data.secret),
    isActive: data.isActive,
  });
  return getCredential(id);
}

export async function updateCredential(id: string, data: Partial<CredentialInput>): Promise<CloudCredentialDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Cuenta de servicio no encontrada");
  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe una cuenta con ese nombre");
  }
  const fields: Partial<repo.Fields> = { name: data.name, isActive: data.isActive };
  // secret vacío/omitido = conservar; con valor = re-cifrar y re-extraer metadatos.
  if (data.secret) {
    const { metadata } = buildSecret(existing.provider, data.secret);
    fields.secretEncrypted = encryptSecret(data.secret);
    fields.metadata = metadata;
  }
  await repo.update(id, fields);
  return getCredential(id);
}

export async function deleteCredential(id: string): Promise<void> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.notFound("Cuenta de servicio no encontrada");
  const used = await repo.countTargetsUsing(id);
  if (used > 0) {
    throw HttpError.conflict(`La cuenta está en uso por ${used} destino(s) de almacenamiento`);
  }
  await repo.remove(id);
}

export async function setDefault(id: string): Promise<CloudCredentialDto> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.notFound("Cuenta de servicio no encontrada");
  await repo.setDefault(id, c.provider);
  return getCredential(id);
}
