import nodemailer from "nodemailer";
import type { NotifRuntimeConfig } from "../settings/settings.service.js";

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

/** Config de correo ya resuelta (rama del NotifRuntimeConfig). */
type EmailConfig = NotifRuntimeConfig["email"];

/**
 * Envía un correo por el proveedor configurado (SMTP o una API HTTP genérica).
 * Lanza si la configuración está incompleta o el transporte falla; el orquestador
 * captura y registra el error sin interrumpir el flujo de backups.
 */
export async function sendEmail(cfg: EmailConfig, msg: EmailMessage): Promise<void> {
  if (!cfg.from) throw new Error("Falta el remitente (from) del correo");
  if (cfg.recipients.length === 0) throw new Error("No hay destinatarios de correo configurados");

  if (cfg.provider === "smtp") {
    await sendViaSmtp(cfg, msg);
  } else {
    await sendViaApi(cfg, msg);
  }
}

async function sendViaSmtp(cfg: EmailConfig, msg: EmailMessage): Promise<void> {
  if (!cfg.smtp.host) throw new Error("Falta el host SMTP");
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.password ?? "" } : undefined,
  });
  await transport.sendMail({
    from: cfg.from,
    to: cfg.recipients.join(", "),
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

/**
 * Envío vía API HTTP: POST JSON con `{ from, to, subject, text, html }`. El header
 * de autorización es configurable (nombre + valor) para adaptarse a distintos
 * proveedores (p. ej. `Authorization: Bearer …` o `X-Api-Key: …`).
 */
async function sendViaApi(cfg: EmailConfig, msg: EmailMessage): Promise<void> {
  if (!cfg.api.url) throw new Error("Falta la URL de la API de correo");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.api.auth) headers[cfg.api.authHeader || "Authorization"] = cfg.api.auth;

  const res = await fetch(cfg.api.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: cfg.from,
      to: cfg.recipients,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`La API de correo respondió ${res.status}: ${body.slice(0, 500)}`);
  }
}
