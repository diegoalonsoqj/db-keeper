import { pool, query } from "../../db/pool.js";

export interface TotpState {
  secretEnc: string | null;
  enabled: boolean;
  lastStep: number | null;
}

export async function getTotpState(userId: string): Promise<TotpState | null> {
  const { rows } = await query<{ totp_secret_enc: string | null; totp_enabled_at: Date | null; totp_last_step: string | null }>(
    `SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM auth.users WHERE id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    secretEnc: r.totp_secret_enc,
    enabled: r.totp_enabled_at != null,
    lastStep: r.totp_last_step == null ? null : Number(r.totp_last_step),
  };
}

/** Guarda un secreto pendiente (aún sin activar). No pisa un TOTP ya activo. */
export async function savePendingSecret(userId: string, secretEnc: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE auth.users SET totp_secret_enc = $2, totp_last_step = NULL
     WHERE id = $1 AND totp_enabled_at IS NULL`,
    [userId, secretEnc],
  );
  return rowCount === 1;
}

/**
 * Registra el paso aceptado solo si es posterior al último: dos peticiones con el
 * mismo código no pueden ganar ambas.
 */
export async function consumeStep(userId: string, step: number): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE auth.users SET totp_last_step = $2
     WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
    [userId, step],
  );
  return rowCount === 1;
}

/** Activa el TOTP y reemplaza los códigos de recuperación, en una transacción. */
export async function enableTotp(userId: string, step: number, codeHashes: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE auth.users SET totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1`, [userId, step]);
    await client.query(`DELETE FROM auth.user_recovery_codes WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO auth.user_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`,
      [userId, codeHashes],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Desactiva el TOTP y borra el secreto y los códigos de recuperación. */
export async function disableTotp(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE auth.users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1`,
      [userId],
    );
    await client.query(`DELETE FROM auth.user_recovery_codes WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Marca usado un código de recuperación vigente (true si existía y no estaba usado). */
export async function useRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE auth.user_recovery_codes SET used_at = now()
     WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [userId, codeHash],
  );
  return rowCount === 1;
}

export async function countRecoveryCodesLeft(userId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM auth.user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}
