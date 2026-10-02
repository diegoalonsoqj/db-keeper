import type { AuthType, Paginated, UserDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword } from "../../lib/password.js";
import { AD_USERNAME_RE, normalizeAdUsername } from "../auth/ldap.js";
import * as repo from "./users.repository.js";

function toDto(u: repo.UserWithSecret): UserDto {
  const { passwordHash: _omit, ...dto } = u;
  return dto;
}

export async function listUsers(p: { limit: number; offset: number }): Promise<Paginated<UserDto>> {
  const { items, total } = await repo.listUsers(p);
  return { items: items.map(toDto), total };
}

export async function getUser(id: string): Promise<UserDto> {
  const u = await repo.findById(id);
  if (!u) throw HttpError.notFound("Usuario no encontrado");
  return toDto(u);
}

export interface CreateUserData {
  username: string;
  email: string | null;
  fullName: string | null;
  authType: AuthType;
  password?: string | null;
  isActive: boolean;
  roleKeys: string[];
}

export async function createUser(data: CreateUserData): Promise<UserDto> {
  if (data.authType === "ad") {
    // Se guarda la cuenta sin dominio ("DINTERSEGURO\jperez" → "jperez"): el dominio
    // lo pone la configuración de AD al autenticar.
    data = { ...data, username: normalizeAdUsername(data.username) };
    if (!AD_USERNAME_RE.test(data.username)) {
      throw HttpError.badRequest("Usuario de red inválido (solo letras, dígitos, punto, guion y guion bajo)");
    }
  }
  if (await repo.findByUsername(data.username)) {
    throw HttpError.conflict("Ya existe un usuario con ese nombre");
  }

  let passwordHash: string | null = null;
  if (data.authType === "local") {
    if (!data.password) throw HttpError.badRequest("La contraseña es obligatoria para usuarios locales");
    passwordHash = await hashPassword(data.password);
  } else if (data.password) {
    throw HttpError.badRequest("Los usuarios de AD no usan contraseña local");
  }

  const id = await repo.insertUser({
    username: data.username,
    email: data.email,
    fullName: data.fullName,
    authType: data.authType,
    passwordHash,
    isActive: data.isActive,
  });
  await repo.setUserRoles(id, data.roleKeys);
  return getUser(id);
}

export interface UpdateUserData {
  email?: string | null;
  fullName?: string | null;
  isActive?: boolean;
  password?: string;
  roleKeys?: string[];
}

export async function updateUser(id: string, data: UpdateUserData): Promise<UserDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Usuario no encontrado");

  let passwordHash: string | null | undefined;
  if (data.password !== undefined) {
    if (existing.authType !== "local") {
      throw HttpError.badRequest("Solo los usuarios locales tienen contraseña");
    }
    passwordHash = await hashPassword(data.password);
  }

  await repo.updateUser(id, {
    email: data.email,
    fullName: data.fullName,
    isActive: data.isActive,
    passwordHash,
  });
  if (data.roleKeys) await repo.setUserRoles(id, data.roleKeys);
  return getUser(id);
}

export async function deleteUser(id: string): Promise<void> {
  const u = await repo.findById(id);
  if (!u) throw HttpError.notFound("Usuario no encontrado");
  await repo.deleteUser(id);
}
