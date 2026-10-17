import type { AuthIdentity, AuthType, Paginated, UserDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { hashPassword } from "../../lib/password.js";
import { AD_USERNAME_RE, normalizeAdUsername } from "../auth/ldap.js";
import { isSuperadmin, permissionsBeyond, SUPERADMIN_ROLE } from "../auth/privileges.js";
import { listRoles } from "../roles/roles.repository.js";
import * as totpRepo from "../auth/totp.repository.js";
import * as repo from "./users.repository.js";

function toDto(u: repo.UserWithSecret): UserDto {
  const { passwordHash: _omit, ...dto } = u;
  return dto;
}

export async function listUsers(p: repo.UserListQuery): Promise<Paginated<UserDto>> {
  const { items, total } = await repo.listUsers(p);
  return { items: items.map(toDto), total };
}

export async function getUser(id: string): Promise<UserDto> {
  const u = await repo.findById(id);
  if (!u) throw HttpError.notFound("Usuario no encontrado");
  return toDto(u);
}

/**
 * Roles que el actor quiere otorgar: deben existir, el superadmin solo lo da otro
 * superadmin, y ningún rol puede traer permisos que el actor no tenga.
 */
async function assertCanGrant(actor: AuthIdentity, roleKeys: string[]): Promise<void> {
  if (roleKeys.length === 0) return;
  const roles = await listRoles();
  for (const key of roleKeys) {
    const role = roles.find((r) => r.key === key);
    if (!role) throw HttpError.badRequest(`Rol inexistente: ${key}`);
    if (key === SUPERADMIN_ROLE && !isSuperadmin(actor)) {
      throw HttpError.forbidden("Solo un superadministrador puede asignar el rol superadmin");
    }
    const beyond = permissionsBeyond(actor, role.permissions);
    if (beyond.length > 0) {
      throw HttpError.forbidden(`No puedes asignar el rol "${role.name}": incluye permisos que no tienes (${beyond.join(", ")})`);
    }
  }
}

/**
 * El actor no puede modificar ni eliminar a alguien con más permisos que él: podría
 * cambiarle la contraseña y entrar con esa cuenta.
 */
async function assertCanManage(actor: AuthIdentity, target: repo.UserWithSecret): Promise<void> {
  if (target.roles.includes(SUPERADMIN_ROLE) && !isSuperadmin(actor)) {
    throw HttpError.forbidden("Solo un superadministrador puede modificar o eliminar a otro superadministrador");
  }
  const beyond = permissionsBeyond(actor, await repo.getUserPermissions(target.id));
  if (beyond.length > 0) {
    throw HttpError.forbidden(`No puedes modificar a un usuario con permisos que no tienes (${beyond.join(", ")})`);
  }
}

/** No dejar el sistema sin un superadmin activo. */
async function assertNotLastSuperadmin(userId: string): Promise<void> {
  if ((await repo.countActiveSuperadmins(userId)) === 0) {
    throw HttpError.badRequest("Debe quedar al menos un superadministrador activo");
  }
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

export async function createUser(actor: AuthIdentity, data: CreateUserData): Promise<UserDto> {
  await assertCanGrant(actor, data.roleKeys);
  if (data.authType === "ad") {
    // Se guarda la cuenta sin dominio ("EMPRESA\jperez" → "jperez"): el dominio
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

export async function updateUser(actor: AuthIdentity, id: string, data: UpdateUserData): Promise<UserDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Usuario no encontrado");

  const targetIsSuper = existing.roles.includes(SUPERADMIN_ROLE);
  await assertCanManage(actor, existing);
  const rolesChange =
    data.roleKeys !== undefined &&
    (data.roleKeys.length !== existing.roles.length || data.roleKeys.some((k) => !existing.roles.includes(k)));
  // Ni subirse ni quitarse privilegios a uno mismo (escalada o bloqueo accidental).
  if (actor.user.id === id && (rolesChange || data.isActive === false)) {
    throw HttpError.badRequest("No puedes cambiar tus propios roles ni desactivar tu cuenta");
  }
  if (rolesChange) {
    // Solo se validan los roles nuevos: conservar los que ya tenía no otorga nada.
    await assertCanGrant(actor, data.roleKeys!.filter((k) => !existing.roles.includes(k)));
  }
  const losesSuper =
    targetIsSuper && (data.isActive === false || (data.roleKeys !== undefined && !data.roleKeys.includes(SUPERADMIN_ROLE)));
  if (losesSuper) await assertNotLastSuperadmin(id);

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

/** Quita el segundo factor de otro usuario (p. ej. perdió el teléfono); entra con solo su contraseña. */
export async function resetUserTotp(actor: AuthIdentity, id: string): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Usuario no encontrado");
  await assertCanManage(actor, existing);
  if (!existing.totpEnabled) throw HttpError.badRequest("El usuario no tiene segundo factor activo");
  await totpRepo.disableTotp(id);
}

export async function deleteUser(actor: AuthIdentity, id: string): Promise<void> {
  const u = await repo.findById(id);
  if (!u) throw HttpError.notFound("Usuario no encontrado");
  await assertCanManage(actor, u);
  if (u.roles.includes(SUPERADMIN_ROLE)) await assertNotLastSuperadmin(id);
  await repo.deleteUser(id);
}
