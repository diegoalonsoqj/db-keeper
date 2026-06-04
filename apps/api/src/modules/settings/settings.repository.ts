import { query } from "../../db/pool.js";

export async function getSetting<T>(key: string): Promise<T | null> {
  const { rows } = await query<{ value: T }>("SELECT value FROM core.app_settings WHERE key = $1", [
    key,
  ]);
  return rows[0]?.value ?? null;
}

export async function upsertSetting(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO core.app_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}
