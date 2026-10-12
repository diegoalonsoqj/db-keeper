import type { AuthIdentity, RoleDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { permissionsBeyond } from "../auth/privileges.js";
import * as repo from "./roles.repository.js";

const SUPERADMIN_KEY = "superadmin";

export async function listRoles(): Promise<RoleDto[]> {
  return repo.listRoles();
}

export async function getRole(id: string): Promise<RoleDto> {
  const r = await repo.findRoleById(id);
  if (!r) throw HttpError.notFound("Rol no encontrado");
  return r;
}

/** Un rol no puede recibir permisos que quien lo edita no tiene (anti-escalada). */
function assertCanGrantPermissions(actor: AuthIdentity, permissions: string[]): void {
  const beyond = permissionsBeyond(actor, permissions);
  if (beyond.length > 0) {
    throw HttpError.forbidden(`No puedes otorgar permisos que no tienes: ${beyond.join(", ")}`);
  }
}

export async function createRole(actor: AuthIdentity, data: {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
}): Promise<RoleDto> {
  assertCanGrantPermissions(actor, data.permissions);
  if (await repo.findRoleByKey(data.key)) {
    throw HttpError.conflict("Ya existe un rol con esa clave");
  }
  const id = await repo.insertRole({ key: data.key, name: data.name, description: data.description });
  await repo.setRolePermissions(id, data.permissions);
  return getRole(id);
}

export async function updateRole(
  actor: AuthIdentity,
  id: string,
  data: { name?: string; description?: string | null; permissions?: string[] },
): Promise<RoleDto> {
  const role = await repo.findRoleById(id);
  if (!role) throw HttpError.notFound("Rol no encontrado");
  // Solo se validan los permisos que se agregan (los que ya tenía no otorgan nada nuevo).
  if (data.permissions) {
    const current = new Set<string>(role.permissions);
    assertCanGrantPermissions(actor, data.permissions.filter((p) => !current.has(p)));
  }

  await repo.updateRoleMeta(id, { name: data.name, description: data.description });

  if (data.permissions) {
    // superadmin conserva todos los permisos para evitar bloqueos del sistema.
    if (role.key === SUPERADMIN_KEY) {
      throw HttpError.forbidden("No se pueden modificar los permisos del rol superadmin");
    }
    await repo.setRolePermissions(id, data.permissions);
  }
  return getRole(id);
}

export async function deleteRole(id: string): Promise<void> {
  const role = await repo.findRoleById(id);
  if (!role) throw HttpError.notFound("Rol no encontrado");
  if (role.isSystem) throw HttpError.forbidden("No se puede eliminar un rol de sistema");
  await repo.deleteRole(id);
}
