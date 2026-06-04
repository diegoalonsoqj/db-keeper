import {
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLES,
  type Role,
} from "@dbkeeper/shared";
import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { pool } from "./pool.js";
import { hashPassword } from "../lib/password.js";

const ROLE_NAMES: Record<Role, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  editor: "Editor",
  operator: "Operador",
  viewer: "Visor",
};

/** Inserta/actualiza el catálogo de permisos desde la definición compartida. */
async function seedPermissions(): Promise<void> {
  for (const p of PERMISSIONS) {
    await pool.query(
      `INSERT INTO auth.permissions (key, category, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, description = EXCLUDED.description`,
      [p.key, p.category, p.description],
    );
  }
  logger.info({ count: PERMISSIONS.length }, "Permisos sembrados");
}

/**
 * Crea los 5 roles de sistema. Los permisos por defecto se aplican solo en la
 * primera siembra de cada rol (no se sobrescriben ediciones posteriores).
 * `superadmin` siempre se fuerza a tener todos los permisos.
 */
async function seedRoles(): Promise<void> {
  for (const key of ROLES) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM auth.roles WHERE key = $1", [
      key,
    ]);
    let roleId = existing.rows[0]?.id;
    const isNew = !roleId;

    if (!roleId) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO auth.roles (key, name, description, is_system)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [key, ROLE_NAMES[key], ROLE_DESCRIPTIONS[key]],
      );
      roleId = ins.rows[0]!.id;
    }

    const hasPerms = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM auth.role_permissions WHERE role_id = $1",
      [roleId],
    );
    const isEmpty = Number(hasPerms.rows[0]?.count ?? 0) === 0;

    if (key === "superadmin" || isNew || isEmpty) {
      const keys = ROLE_DEFAULT_PERMISSIONS[key];
      await pool.query("DELETE FROM auth.role_permissions WHERE role_id = $1", [roleId]);
      await pool.query(
        `INSERT INTO auth.role_permissions (role_id, permission_key)
         SELECT $1, p.key FROM auth.permissions p WHERE p.key = ANY($2::text[])`,
        [roleId, keys],
      );
    }
  }
  logger.info({ count: ROLES.length }, "Roles de sistema sembrados");
}

/** Crea un superadmin inicial si la base no tiene usuarios. */
async function seedBootstrapAdmin(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM auth.users",
  );
  if (Number(rows[0]?.count ?? 0) > 0) {
    logger.info("Ya existen usuarios; se omite el bootstrap del superadmin");
    return;
  }

  const username = env.BOOTSTRAP_ADMIN_USERNAME;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
  const hash = await hashPassword(password);

  const ins = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (username, full_name, auth_type, password_hash, is_active)
     VALUES ($1, $2, 'local', $3, true) RETURNING id`,
    [username, "Superadministrador", hash],
  );
  await pool.query(
    `INSERT INTO auth.user_roles (user_id, role_id)
     SELECT $1, id FROM auth.roles WHERE key = 'superadmin'`,
    [ins.rows[0]!.id],
  );

  logger.warn(
    { username },
    env.BOOTSTRAP_ADMIN_PASSWORD
      ? "Superadmin creado con la contraseña de BOOTSTRAP_ADMIN_PASSWORD"
      : `Superadmin creado. CONTRASEÑA TEMPORAL: ${password}  (cámbiala tras el primer login)`,
  );
}

async function run(): Promise<void> {
  await seedPermissions();
  await seedRoles();
  await seedBootstrapAdmin();
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "Falló el seed");
    await pool.end();
    process.exit(1);
  });
