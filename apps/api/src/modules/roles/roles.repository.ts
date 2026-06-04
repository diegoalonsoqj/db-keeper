import type { PermissionKey, RoleDto } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permission_keys: string[];
}

function toRole(row: RoleRow): RoleDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissions: row.permission_keys.filter((k): k is PermissionKey => k !== null) as PermissionKey[],
  };
}

const SELECT_ROLE = `
  SELECT r.*, COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permission_keys
  FROM auth.roles r
  LEFT JOIN auth.role_permissions rp ON rp.role_id = r.id
`;

export async function listRoles(): Promise<RoleDto[]> {
  const { rows } = await query<RoleRow>(`${SELECT_ROLE} GROUP BY r.id ORDER BY r.key`);
  return rows.map(toRole);
}

export async function findRoleById(id: string): Promise<RoleDto | null> {
  const { rows } = await query<RoleRow>(`${SELECT_ROLE} WHERE r.id = $1 GROUP BY r.id`, [id]);
  return rows[0] ? toRole(rows[0]) : null;
}

export async function findRoleByKey(key: string): Promise<RoleDto | null> {
  const { rows } = await query<RoleRow>(`${SELECT_ROLE} WHERE r.key = $1 GROUP BY r.id`, [key]);
  return rows[0] ? toRole(rows[0]) : null;
}

export async function insertRole(input: {
  key: string;
  name: string;
  description: string | null;
}): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO auth.roles (key, name, description, is_system) VALUES ($1, $2, $3, false) RETURNING id`,
    [input.key, input.name, input.description],
  );
  return rows[0]!.id;
}

export async function updateRoleMeta(
  id: string,
  input: { name?: string; description?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) (sets.push(`name = $${i++}`), params.push(input.name));
  if (input.description !== undefined)
    (sets.push(`description = $${i++}`), params.push(input.description));
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE auth.roles SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function setRolePermissions(roleId: string, keys: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM auth.role_permissions WHERE role_id = $1", [roleId]);
    if (keys.length > 0) {
      await client.query(
        `INSERT INTO auth.role_permissions (role_id, permission_key)
         SELECT $1, p.key FROM auth.permissions p WHERE p.key = ANY($2::text[])`,
        [roleId, keys],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteRole(id: string): Promise<void> {
  await query("DELETE FROM auth.roles WHERE id = $1", [id]);
}
