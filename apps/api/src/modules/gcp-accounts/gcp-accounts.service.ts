import type { GcpServiceAccountDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { encryptSecret } from "../../lib/crypto.js";
import * as repo from "./gcp-accounts.repository.js";

export async function listAccounts(p: { limit: number; offset: number }) {
  return repo.list(p);
}

export async function getAccount(id: string): Promise<GcpServiceAccountDto> {
  const acc = await repo.findById(id);
  if (!acc) throw HttpError.notFound("Cuenta de servicio no encontrada");
  return acc;
}

/** Extrae metadatos no secretos del JSON de la cuenta de servicio. */
function parseKey(key: string): { clientEmail: string | null; projectId: string | null } {
  let json: unknown;
  try {
    json = JSON.parse(key);
  } catch {
    throw HttpError.badRequest("La clave no es un JSON válido");
  }
  if (typeof json !== "object" || json === null) {
    throw HttpError.badRequest("La clave debe ser el JSON de la cuenta de servicio");
  }
  const o = json as Record<string, unknown>;
  return {
    clientEmail: typeof o.client_email === "string" ? o.client_email : null,
    projectId: typeof o.project_id === "string" ? o.project_id : null,
  };
}

export interface AccountInput {
  name: string;
  key?: string;
  isActive: boolean;
}

export async function createAccount(data: AccountInput): Promise<GcpServiceAccountDto> {
  if (!data.key) throw HttpError.badRequest("La clave (JSON) es obligatoria");
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe una cuenta con ese nombre");
  }
  const meta = parseKey(data.key);
  const id = await repo.insert({
    name: data.name,
    clientEmail: meta.clientEmail,
    projectId: meta.projectId,
    keyEncrypted: encryptSecret(data.key),
    isActive: data.isActive,
  });
  return getAccount(id);
}

export async function updateAccount(id: string, data: Partial<AccountInput>): Promise<GcpServiceAccountDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Cuenta de servicio no encontrada");
  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe una cuenta con ese nombre");
  }
  const fields: Partial<repo.Fields> = { name: data.name, isActive: data.isActive };
  // key vacía/omitida = conservar la actual; con valor = re-cifrar y re-extraer metadatos.
  if (data.key) {
    const meta = parseKey(data.key);
    fields.keyEncrypted = encryptSecret(data.key);
    fields.clientEmail = meta.clientEmail;
    fields.projectId = meta.projectId;
  }
  await repo.update(id, fields);
  return getAccount(id);
}

export async function deleteAccount(id: string): Promise<void> {
  const acc = await repo.findById(id);
  if (!acc) throw HttpError.notFound("Cuenta de servicio no encontrada");
  const used = await repo.countTargetsUsing(id);
  if (used > 0) {
    throw HttpError.conflict(`La cuenta está en uso por ${used} destino(s) de almacenamiento`);
  }
  await repo.remove(id);
}

export async function setDefault(id: string): Promise<GcpServiceAccountDto> {
  if (!(await repo.findById(id))) throw HttpError.notFound("Cuenta de servicio no encontrada");
  await repo.setDefault(id);
  return getAccount(id);
}
