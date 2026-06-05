import type { CredentialDto, CredentialInput } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { encryptSecret } from "../../lib/crypto.js";
import * as repo from "./credentials.repository.js";

export async function listCredentials(): Promise<CredentialDto[]> {
  return repo.listCredentials();
}

export async function getCredential(id: string): Promise<CredentialDto> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.notFound("Credencial no encontrada");
  return c;
}

export async function createCredential(data: CredentialInput): Promise<CredentialDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe una credencial con ese nombre");
  }
  if (!data.password) throw HttpError.badRequest("La contraseña es obligatoria");
  const id = await repo.insertCredential({
    name: data.name,
    username: data.username,
    passwordEncrypted: encryptSecret(data.password),
    extraEncrypted: data.extra ? encryptSecret(JSON.stringify(data.extra)) : null,
    description: data.description ?? null,
  });
  return getCredential(id);
}

export async function updateCredential(
  id: string,
  data: Partial<CredentialInput>,
): Promise<CredentialDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Credencial no encontrada");

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe una credencial con ese nombre");
  }

  const fields: Partial<repo.CredentialFields> = {
    name: data.name,
    username: data.username,
    description: data.description,
  };
  if (data.password) fields.passwordEncrypted = encryptSecret(data.password);
  if (data.extra !== undefined) {
    fields.extraEncrypted = data.extra ? encryptSecret(JSON.stringify(data.extra)) : null;
  }
  await repo.updateCredential(id, fields);
  return getCredential(id);
}

export async function deleteCredential(id: string): Promise<void> {
  const c = await repo.findById(id);
  if (!c) throw HttpError.notFound("Credencial no encontrada");
  const used = await repo.countServersUsing(id);
  if (used > 0) {
    throw HttpError.conflict(`La credencial está en uso por ${used} instancia(s)`);
  }
  await repo.deleteCredential(id);
}
