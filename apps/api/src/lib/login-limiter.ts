import { query } from "../db/pool.js";
import { logger } from "../config/logger.js";

/**
 * Límite de intentos de login fallidos, en PostgreSQL (auth.login_attempts): sobrevive
 * a reinicios y lo comparten todas las instancias, con el reloj de la BD como única
 * referencia. Se cuenta por usuario y por IP: el de usuario protege cada cuenta (y
 * evita bloquear la cuenta de dominio en AD); el de IP frena barridos de muchos usuarios.
 */
export interface LimitPolicy {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
}

/** Milisegundos de bloqueo restantes para la clave (0 = no bloqueada). */
export async function lockRemainingMs(key: string): Promise<number> {
  const { rows } = await query<{ ms: number }>(
    `SELECT GREATEST(0, EXTRACT(EPOCH FROM (locked_until - now())) * 1000)::float8 AS ms
     FROM auth.login_attempts WHERE key = $1 AND locked_until IS NOT NULL`,
    [key],
  );
  return Math.ceil(rows[0]?.ms ?? 0);
}

/** Registra un fallo; al alcanzar el máximo dentro de la ventana, bloquea la clave. */
export async function registerFailure(key: string, policy: LimitPolicy): Promise<void> {
  const windowSecs = policy.windowMs / 1000;
  // Ventana vencida: el conteo vuelve a empezar.
  const { rows } = await query<{ fails: number }>(
    `INSERT INTO auth.login_attempts AS a (key, fails, first_at) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       fails    = CASE WHEN a.first_at < now() - make_interval(secs => $2) THEN 1 ELSE a.fails + 1 END,
       first_at = CASE WHEN a.first_at < now() - make_interval(secs => $2) THEN now() ELSE a.first_at END
     RETURNING fails`,
    [key, windowSecs],
  );
  if ((rows[0]?.fails ?? 0) >= policy.maxAttempts) {
    await query(
      `UPDATE auth.login_attempts
       SET locked_until = now() + make_interval(secs => $2), fails = 0, first_at = now()
       WHERE key = $1`,
      [key, policy.lockMs / 1000],
    );
  }
}

/** Login correcto: olvida los fallos de la clave. */
export async function resetKey(key: string): Promise<void> {
  await query("DELETE FROM auth.login_attempts WHERE key = $1", [key]);
}

// Limpieza periódica de entradas vencidas (sin bloqueo vigente y fuera de cualquier ventana).
const SWEEP_MS = 10 * 60_000;
setInterval(() => {
  query(
    `DELETE FROM auth.login_attempts
     WHERE (locked_until IS NULL OR locked_until < now()) AND first_at < now() - interval '24 hours'`,
  ).catch((err) => logger.warn({ err }, "No se pudieron limpiar los intentos de login vencidos"));
}, SWEEP_MS).unref();
