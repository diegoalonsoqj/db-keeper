import type { NotifRuntimeConfig } from "../settings/settings.service.js";

type TelegramConfig = NotifRuntimeConfig["telegram"];

/**
 * Envía un mensaje por Telegram (Bot API `sendMessage`). Se envía como texto plano
 * (sin parse_mode): el HTML de Telegram no soporta `<br>` ni etiquetas arbitrarias,
 * así que el orquestador pasa el texto con saltos de línea reales `\n`.
 * Lanza si falta el token/chat o si la API responde con error; el orquestador captura
 * el fallo. El token nunca se incluye en los mensajes de error.
 */
export async function sendTelegram(cfg: TelegramConfig, text: string): Promise<void> {
  if (!cfg.botToken) throw new Error("Falta el bot token de Telegram");
  if (!cfg.chatId) throw new Error("Falta el chat de destino de Telegram");

  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    // No incluir el cuerpo de la URL (lleva el token); la API repite descripciones seguras.
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram respondió ${res.status}: ${body.slice(0, 500)}`);
  }
}
