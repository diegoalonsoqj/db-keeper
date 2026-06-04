import type { RoleDto } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
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

export async function createRole(data: {
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
}): Promise<RoleDto> {
  if (await repo.findRoleByKey(data.key)) {
    throw HttpError.conflict("Ya existe un rol con esa clave");
  }
  const id = await repo.insertRole({ key: data.key, name: data.name, description: data.description });
  await repo.setRolePermissions(id, data.permissions);
  return getRole(id);
}

export async function updateRole(
  id: string,
  data: { name?: string; description?: string | null; permissions?: string[] },
): Promise<RoleDto> {
  const role = await repo.findRoleById(id);
  if (!role) throw HttpError.notFound("Rol no encontrado");

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
