import type { AuthIdentity, PermissionKey, UserDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { verifyPassword } from "../../lib/password.js";
import * as usersRepo from "../users/users.repository.js";
import type { UserWithSecret } from "../users/users.repository.js";
import { getLdapRuntimeConfig } from "../settings/settings.service.js";
import { authenticateLdap } from "./ldap.js";

function stripSecret(u: UserWithSecret): UserDto {
  const { passwordHash: _omit, ...dto } = u;
  return dto;
}

/**
 * Valida credenciales según el tipo de usuario y devuelve el usuario.
 * Los usuarios de AD deben existir previamente en auth.users (los provisiona
 * un admin desde el módulo Usuarios) y se validan contra LDAP.
 */
export async function login(username: string, password: string): Promise<UserDto> {
  const user = await usersRepo.findByUsername(username);
  // Mensaje genérico para no revelar si el usuario existe.
  const invalid = HttpError.unauthorized("Usuario o contraseña inválidos");

  if (!user) throw invalid;
  if (!user.isActive) throw HttpError.forbidden("La cuenta está inactiva");

  if (user.authType === "local") {
    if (!user.passwordHash) throw invalid;
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw invalid;
  } else {
    const ldapConfig = await getLdapRuntimeConfig();
    if (!ldapConfig) {
      throw HttpError.unauthorized("La autenticación AD/LDAP no está configurada");
    }
    const ldapUser = await authenticateLdap(user.username, password, ldapConfig);
    if (!ldapUser) throw invalid;
  }

  await usersRepo.touchLastLogin(user.id);
  return stripSecret(user);
}

/** Identidad completa (usuario + permisos efectivos) para /api/auth/me. */
export async function getIdentity(userId: string): Promise<AuthIdentity | null> {
  const user = await usersRepo.findById(userId);
  if (!user || !user.isActive) return null;
  const permissions = (await usersRepo.getUserPermissions(userId)) as PermissionKey[];
  return { user: stripSecret(user), permissions };
}
