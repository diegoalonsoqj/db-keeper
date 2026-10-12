import type { AuthIdentity } from "@dbkeeper/shared";

/**
 * Reglas anti-escalada de privilegios (gestión de usuarios y roles):
 * - Solo un superadmin asigna/quita el rol superadmin o modifica a un superadmin.
 * - Nadie otorga permisos que no tiene (al asignar roles o al editar sus permisos).
 */
export const SUPERADMIN_ROLE = "superadmin";

export function isSuperadmin(actor: AuthIdentity): boolean {
  return actor.user.roles.includes(SUPERADMIN_ROLE);
}

/** Permisos de la lista que el actor no tiene (el superadmin los tiene todos). */
export function permissionsBeyond(actor: AuthIdentity, permissions: readonly string[]): string[] {
  if (isSuperadmin(actor)) return [];
  const own = new Set<string>(actor.permissions);
  return permissions.filter((p) => !own.has(p));
}
