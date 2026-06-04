import type { CredentialInput, DbEngine, ServerDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { encryptSecret } from "../../lib/crypto.js";
import * as repo from "./servers.repository.js";
import type { CredentialFields, ServerFields } from "./servers.repository.js";

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
}

function encryptCredential(cred: CredentialInput): CredentialFields {
  return {
    username: cred.username,
    passwordEncrypted: encryptSecret(cred.password ?? ""),
    extraEncrypted: cred.extra ? encryptSecret(JSON.stringify(cred.extra)) : null,
  };
}

export async function createServer(data: ServerData, credential: CredentialInput): Promise<ServerDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe una instancia con ese nombre");
  }
  if (!credential.password) {
    throw HttpError.badRequest("La contraseña de la credencial es obligatoria");
  }
  const id = await repo.insertServer(data as ServerFields, encryptCredential(credential));
  return getServer(id);
}

export async function updateServer(
  id: string,
  data: Partial<ServerData>,
  credential?: CredentialInput,
): Promise<ServerDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Instancia no encontrada");

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe una instancia con ese nombre");
  }

  await repo.updateServerFields(id, data as Partial<ServerFields>);

  if (credential) {
    let fields: CredentialFields;
    if (credential.password) {
      fields = encryptCredential(credential);
    } else {
      // Mantener la contraseña/extra actuales y solo actualizar el usuario.
      const current = await repo.getEncryptedCredential(id);
      if (!current) throw HttpError.badRequest("La contraseña es obligatoria para la nueva credencial");
      fields = {
        username: credential.username,
        passwordEncrypted: current.passwordEncrypted,
        extraEncrypted:
          credential.extra !== undefined
            ? credential.extra
              ? encryptSecret(JSON.stringify(credential.extra))
              : null
            : current.extraEncrypted,
      };
    }
    await repo.upsertCredential(id, fields);
  }

  return getServer(id);
}

export async function deleteServer(id: string): Promise<void> {
  const s = await repo.findById(id);
  if (!s) throw HttpError.notFound("Instancia no encontrada");
  await repo.deleteServer(id);
}
