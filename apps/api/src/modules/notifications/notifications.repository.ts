import { query } from "../../db/pool.js";

/** Mensaje raíz de Telegram de una ejecución (null si aún no se envió ninguno). */
export async function findTelegramRoot(executionId: string): Promise<{ chatId: string; messageId: number } | null> {
  const { rows } = await query<{ telegram_chat_id: string | null; telegram_message_id: string | null }>(
    `SELECT telegram_chat_id, telegram_message_id FROM core.executions WHERE id = $1`,
    [executionId],
  );
  const r = rows[0];
  if (!r?.telegram_chat_id || r.telegram_message_id == null) return null;
  return { chatId: r.telegram_chat_id, messageId: Number(r.telegram_message_id) };
}

/** Fija la raíz si no había una o era de otro chat (el primer aviso enviado manda). */
export async function saveTelegramRoot(executionId: string, chatId: string, messageId: number): Promise<void> {
  await query(
    `UPDATE core.executions SET telegram_chat_id = $2, telegram_message_id = $3
     WHERE id = $1 AND (telegram_message_id IS NULL OR telegram_chat_id IS DISTINCT FROM $2)`,
    [executionId, chatId, messageId],
  );
}
