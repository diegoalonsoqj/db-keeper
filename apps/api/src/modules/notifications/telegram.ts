import type { NotifRuntimeConfig } from "../settings/settings.service.js";

type TelegramConfig = NotifRuntimeConfig["telegram"];

/**
 * Envía un mensaje por Telegram (Bot API `sendMessage`, parse_mode HTML).
 * Importante: el HTML de Telegram **no soporta `<br>`** ni etiquetas arbitrarias; los
 * saltos de línea deben ser `\n` reales (el orquestador arma el HTML con `\n` y solo
 * `<b>`). Lanza si falta el token/chat o si la API responde con error; el orquestador
 * captura el fallo. El token nunca se incluye en los mensajes de error.
 * `replyTo`: id del mensaje al que se responde (hilo); si ya no existe, se envía igual.
 * Devuelve el id del mensaje enviado.
 */
export async function sendTelegram(cfg: TelegramConfig, html: string, replyTo?: number | null): Promise<number | null> {
  if (!cfg.botToken) throw new Error("Falta el bot token de Telegram");
  if (!cfg.chatId) throw new Error("Falta el chat de destino de Telegram");

  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
  });
  if (!res.ok) {
    // No incluir el cuerpo de la URL (lleva el token); la API repite descripciones seguras.
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram respondió ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return data?.result?.message_id ?? null;
}
