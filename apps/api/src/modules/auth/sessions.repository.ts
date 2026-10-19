import { query } from "../../db/pool.js";

/** Invalida todas las sesiones emitidas hasta ahora: sube la versión de sesión del usuario. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await query("UPDATE auth.users SET session_version = session_version + 1 WHERE id = $1", [userId]);
}

/** Versión vigente, la que se graba en cada token nuevo. */
export async function getSessionVersion(userId: string): Promise<number> {
  const { rows } = await query<{ session_version: number }>("SELECT session_version FROM auth.users WHERE id = $1", [
    userId,
  ]);
  return rows[0]?.session_version ?? 0;
}

/** Revoca un token suelto (logout) hasta su vencimiento y limpia los ya vencidos. */
export async function revokeSession(jti: string, expiresAt: Date): Promise<void> {
  await query("INSERT INTO auth.revoked_sessions (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING", [
    jti,
    expiresAt,
  ]);
  await query("DELETE FROM auth.revoked_sessions WHERE expires_at < now()");
}

/** ¿El token ya no vale? De una versión anterior o cerrado con logout. */
export async function isSessionRevoked(userId: string, version: number, jti: string | null): Promise<boolean> {
  const { rows } = await query<{ revoked: boolean }>(
    `SELECT u.session_version <> $2
            OR EXISTS (SELECT 1 FROM auth.revoked_sessions r WHERE r.jti = $3) AS revoked
     FROM auth.users u WHERE u.id = $1`,
    [userId, version, jti],
  );
  return rows[0]?.revoked ?? true;
}
