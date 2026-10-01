import type { CloudCredentialDto, CloudProvider } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import type { ComputeIdentityDto } from "@dbkeeper/shared";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { detectComputeIdentity } from "../../lib/gce-metadata.js";
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
  if (data.secret && existing.kind === "compute") {
    throw HttpError.badRequest("La cuenta de la VM no usa clave: su identidad la da Compute Engine");
  }
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
    throw HttpError.conflict(`La cuenta está en uso por ${used} destino(s) de almacenamiento o instancia(s)`);
  }
  await repo.remove(id);
}

export async function setDefault(id: string): Promise<CloudCredentialDto> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.notFound("Cuenta de servicio no encontrada");
  if (!c.isActive) throw HttpError.badRequest("Una cuenta inactiva no puede ser la predeterminada");
  await repo.setDefault(id, c.provider);
  return getCredential(id);
}

/**
 * Clave JSON de una credencial del catálogo. null = autenticar con ADC (es el caso de
 * la cuenta de la VM, `compute`, sin clave). Una cuenta **inactiva** no se usa: lanza
 * un error claro en vez de seguir autenticando con ella.
 */
export async function getServiceAccountJson(id: string): Promise<string | null> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.badRequest("La cuenta de servicio asignada ya no existe");
  if (!c.isActive) {
    throw HttpError.badRequest(`La cuenta de servicio '${c.name}' está inactiva; actívala o asigna otra`);
  }
  const enc = await repo.getSecretEncrypted(id);
  return enc ? decryptSecret(enc) : null;
}

/** Al asignar una cuenta (destino o instancia): debe existir, ser del proveedor y estar activa. */
export async function assertAssignable(id: string, provider: CloudProvider): Promise<void> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.badRequest("La cuenta de servicio seleccionada no existe");
  if (c.provider !== provider) {
    throw HttpError.badRequest(`La cuenta de servicio '${c.name}' no es del proveedor ${provider}`);
  }
  if (!c.isActive) throw HttpError.badRequest(`La cuenta de servicio '${c.name}' está inactiva`);
}

/**
 * Clave JSON de la service account GCP a usar: la indicada o, si no hay, la GCP
 * activa por defecto del catálogo. null = Application Default Credentials (ADC).
 */
export async function resolveGcpServiceAccountJson(id: string | null): Promise<string | null> {
  const credId = id ?? (await repo.findDefaultActiveId("gcp"));
  return credId ? getServiceAccountJson(credId) : null;
}

/** Identidad de la VM de Compute Engine (si DBKeeper corre en una) y si ya está en el catálogo. */
export async function detectCompute(): Promise<ComputeIdentityDto> {
  const id = await detectComputeIdentity();
  return { ...id, credentialId: id.available ? await repo.findComputeId("gcp") : null };
}

/**
 * Agrega la cuenta de servicio de la VM al catálogo (sin clave) para poder elegirla
 * en destinos e instancias como cualquier otra.
 */
export async function createComputeCredential(): Promise<CloudCredentialDto> {
  const id = await detectComputeIdentity();
  if (!id.available || !id.email) {
    throw HttpError.badRequest("No se detectó una cuenta de servicio de Compute Engine: DBKeeper no corre en una VM de GCP o la VM no tiene cuenta asignada");
  }
  if (await repo.findComputeId("gcp")) throw HttpError.conflict("La cuenta de la VM ya está en el catálogo");
  const name = `VM: ${id.email}`;
  if (await repo.findByName(name)) throw HttpError.conflict("Ya existe una cuenta con ese nombre");
  const newId = await repo.insert({
    name,
    provider: "gcp",
    kind: "compute",
    metadata: { clientEmail: id.email, projectId: id.projectId },
    secretEncrypted: null,
    isActive: true,
  });
  return getCredential(newId);
}
