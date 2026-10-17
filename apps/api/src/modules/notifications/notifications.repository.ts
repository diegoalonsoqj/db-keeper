import { query } from "../../db/pool.js";

/** Dueño de un hilo de Telegram: una ejecución suelta o una corrida de grupo. */
export interface TelegramThread {
  kind: "execution" | "group_run";
  id: string;
}

// Tabla fija por tipo (nunca viene del usuario).
const TABLE: Record<TelegramThread["kind"], string> = {
  execution: "core.executions",
  group_run: "core.group_runs",
};

/** Mensaje raíz de Telegram del hilo (null si aún no se envió ninguno). */
export async function findTelegramRoot(t: TelegramThread): Promise<{ chatId: string; messageId: number } | null> {
  const { rows } = await query<{ telegram_chat_id: string | null; telegram_message_id: string | null }>(
    `SELECT telegram_chat_id, telegram_message_id FROM ${TABLE[t.kind]} WHERE id = $1`,
    [t.id],
  );
  const r = rows[0];
  if (!r?.telegram_chat_id || r.telegram_message_id == null) return null;
  return { chatId: r.telegram_chat_id, messageId: Number(r.telegram_message_id) };
}

/** Fija la raíz si no había una o era de otro chat (el primer aviso enviado manda). */
export async function saveTelegramRoot(t: TelegramThread, chatId: string, messageId: number): Promise<void> {
  await query(
    `UPDATE ${TABLE[t.kind]} SET telegram_chat_id = $2, telegram_message_id = $3
     WHERE id = $1 AND (telegram_message_id IS NULL OR telegram_chat_id IS DISTINCT FROM $2)`,
    [t.id, chatId, messageId],
  );
}
