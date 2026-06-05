import type { AuthType, UserDto } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

/** Fila de auth.users tal como vive en la BD. */
interface UserRow {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  auth_type: AuthType;
  password_hash: string | null;
  is_active: boolean;
  avatar: string | null;
  preferred_language: string | null;
  preferred_theme: "dark" | "light" | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  role_keys: string[];
}

export interface UserWithSecret extends UserDto {
  passwordHash: string | null;
}

function toUser(row: UserRow): UserWithSecret {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    authType: row.auth_type,
    isActive: row.is_active,
    roles: row.role_keys.filter((k): k is string => k !== null),
    avatar: row.avatar,
    preferredLanguage: row.preferred_language,
    preferredTheme: row.preferred_theme,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    passwordHash: row.password_hash,
  };
}

/** SELECT base con los roles agregados. */
const SELECT_USER = `
  SELECT u.*, COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS role_keys
  FROM auth.users u
  LEFT JOIN auth.user_roles ur ON ur.user_id = u.id
  LEFT JOIN auth.roles r ON r.id = ur.role_id
`;

export async function findByUsername(username: string): Promise<UserWithSecret | null> {
  const { rows } = await query<UserRow>(
    `${SELECT_USER} WHERE lower(u.username) = lower($1) GROUP BY u.id`,
    [username],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findById(id: string): Promise<UserWithSecret | null> {
  const { rows } = await query<UserRow>(`${SELECT_USER} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function listUsers(p: {
  limit: number;
  offset: number;
}): Promise<{ items: UserWithSecret[]; total: number }> {
  const total = await countUsers();
  const { rows } = await query<UserRow>(
    `${SELECT_USER} GROUP BY u.id ORDER BY u.username LIMIT $1 OFFSET $2`,
    [p.limit, p.offset],
  );
  return { items: rows.map(toUser), total };
}

export async function countUsers(): Promise<number> {
  const { rows } = await query<{ count: string }>("SELECT count(*)::text AS count FROM auth.users");
  return Number(rows[0]?.count ?? 0);
}

export interface CreateUserInput {
  username: string;
  email: string | null;
  fullName: string | null;
  authType: AuthType;
  passwordHash: string | null;
  isActive: boolean;
}

export async function insertUser(input: CreateUserInput): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO auth.users (username, email, full_name, auth_type, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.username, input.email, input.fullName, input.authType, input.passwordHash, input.isActive],
  );
  return rows[0]!.id;
}

export interface UpdateUserInput {
  email?: string | null;
  fullName?: string | null;
  isActive?: boolean;
  passwordHash?: string | null;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.email !== undefined) (sets.push(`email = $${i++}`), params.push(input.email));
  if (input.fullName !== undefined) (sets.push(`full_name = $${i++}`), params.push(input.fullName));
  if (input.isActive !== undefined) (sets.push(`is_active = $${i++}`), params.push(input.isActive));
  if (input.passwordHash !== undefined)
    (sets.push(`password_hash = $${i++}`), params.push(input.passwordHash));
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE auth.users SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

export async function deleteUser(id: string): Promise<void> {
  await query("DELETE FROM auth.users WHERE id = $1", [id]);
}

export interface ProfileInput {
  fullName?: string | null;
  email?: string | null;
  avatar?: string | null;
  preferredLanguage?: string | null;
  preferredTheme?: "dark" | "light" | null;
}

/** Actualiza los campos de perfil propios del usuario. */
export async function updateProfile(id: string, input: ProfileInput): Promise<void> {
  const map: Record<string, string> = {
    fullName: "full_name",
    email: "email",
    avatar: "avatar",
    preferredLanguage: "preferred_language",
    preferredTheme: "preferred_theme",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) (sets.push(`${col} = $${i++}`), params.push(v));
  }
  if (sets.length === 0) return;
  params.push(id);
  await query(`UPDATE auth.users SET ${sets.join(", ")} WHERE id = $${i}`, params);
}

/** Hash de contraseña actual (para verificar el cambio de contraseña propio). */
export async function getPasswordHash(id: string): Promise<string | null> {
  const { rows } = await query<{ password_hash: string | null }>(
    "SELECT password_hash FROM auth.users WHERE id = $1",
    [id],
  );
  return rows[0]?.password_hash ?? null;
}

export async function touchLastLogin(id: string): Promise<void> {
  await query("UPDATE auth.users SET last_login_at = now() WHERE id = $1", [id]);
}

/** Reemplaza el conjunto de roles del usuario (por keys de rol). */
export async function setUserRoles(userId: string, roleKeys: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM auth.user_roles WHERE user_id = $1", [userId]);
    if (roleKeys.length > 0) {
      await client.query(
        `INSERT INTO auth.user_roles (user_id, role_id)
         SELECT $1, r.id FROM auth.roles r WHERE r.key = ANY($2::text[])`,
        [userId, roleKeys],
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

/** Permisos efectivos del usuario (unión de los de todos sus roles). */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const { rows } = await query<{ permission_key: string }>(
    `SELECT DISTINCT rp.permission_key
     FROM auth.user_roles ur
     JOIN auth.role_permissions rp ON rp.role_id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.permission_key);
}
