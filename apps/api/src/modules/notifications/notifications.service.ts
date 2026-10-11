import { logger } from "../../config/logger.js";
import { formatBytes } from "../../lib/format.js";
import * as settings from "../settings/settings.service.js";
import type { NotifRuntimeConfig } from "../settings/settings.service.js";
import { sendEmail } from "./email.js";
import { escapeHtml, renderEmail, type EmailTone } from "./email-template.js";
import { sendTelegram } from "./telegram.js";

/** `integrity`: "Verificar ahora" detectó un archivo alterado o faltante. */
export type BackupEvent = "start" | "success" | "failure" | "integrity";

/** Resultado de una BD dentro de la corrida (para el detalle del aviso de fin). */
export interface BackupItemResult {
  dbName: string;
  status: "success" | "failed";
  bytes?: number | null;
  error?: string | null;
}

/** Datos de una corrida de backup para componer el aviso. */
export interface BackupNotification {
  event: BackupEvent;
  jobName: string;
  engine: string;
  environment?: string | null;
  databases: string[];
  /** Dónde quedó el backup: "Local" o "<bucket>/<ruta>". */
  storage?: string | null;
  /** Solo para eventos de fin (success/failure). */
  durationMs?: number | null;
  totalBytes?: number | null;
  items?: BackupItemResult[];
}

/** Etiqueta corta (sin emoji) para el asunto del correo. */
const EVENT_LABEL: Record<BackupEvent, string> = {
  start: "Backup iniciado",
  success: "Backup completado",
  failure: "Backup con errores",
  integrity: "Backup alterado o faltante",
};

/** Correo: tono, estado y frase de apertura por evento. */
const EVENT_EMAIL: Record<BackupEvent, { tone: EmailTone; status: string; intro: string }> = {
  start: { tone: "info", status: "En curso", intro: "Se inició la ejecución del evento de backup." },
  success: { tone: "success", status: "Completado", intro: "El backup terminó correctamente en todas las bases de datos." },
  failure: {
    tone: "danger",
    status: "Con errores",
    intro: "El backup terminó con errores en al menos una base de datos. Revisa el detalle y el log de la ejecución en DBKeeper.",
  },
  integrity: {
    tone: "warning",
    status: "Integridad",
    intro: "La verificación detectó un archivo de backup alterado o que ya no existe en el almacenamiento.",
  },
};

const sentAt = (): string => new Date().toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

/** Encabezado del mensaje de Telegram, con emoji por estado. */
const EVENT_HEAD: Record<BackupEvent, string> = {
  start: "🚀 Backup iniciado",
  success: "✅ Backup completado",
  failure: "❌ Backup con errores",
  integrity: "⚠️ Integridad del backup comprometida",
};

/** Nombre presentable del motor. */
const ENGINE_LABEL: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongo: "MongoDB",
  mongodb: "MongoDB",
  sqlserver: "SQL Server",
};
const engineLabel = (e: string): string => ENGINE_LABEL[e] ?? e;

function eventEnabled(cfg: NotifRuntimeConfig, event: BackupEvent): boolean {
  if (event === "start") return cfg.notifyOnStart;
  if (event === "success") return cfg.notifyOnSuccess;
  return cfg.notifyOnFailure;
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Filas (emoji + etiqueta + valor) del resumen, comunes a todos los canales. */
function summaryRows(n: BackupNotification): { emoji: string; label: string; value: string }[] {
  const rows = [
    { emoji: "🏷️", label: "Evento", value: n.jobName },
    { emoji: "🗄️", label: "Motor", value: engineLabel(n.engine) },
  ];
  if (n.environment) rows.push({ emoji: "🌎", label: "Ambiente", value: n.environment });
  rows.push({ emoji: "💾", label: "Bases de datos", value: n.databases.join(", ") || "—" });
  if (n.storage) rows.push({ emoji: "🗂️", label: "Almacenamiento", value: n.storage });
  if (n.event === "success" || n.event === "failure") {
    rows.push({ emoji: "⏱️", label: "Duración", value: formatDuration(n.durationMs) });
    rows.push({ emoji: "📦", label: "Peso total", value: formatBytes(n.totalBytes) });
  }
  return rows;
}

/** Detalle por BD (solo eventos de fin con ítems): emoji de estado + línea. */
function detailItems(n: BackupNotification): { ok: boolean; emoji: string; text: string }[] | null {
  if (n.event === "start" || !n.items || n.items.length === 0) return null;
  return n.items.map((it) => ({
    ok: it.status === "success",
    emoji: it.status === "success" ? "✅" : "❌",
    text: `${it.dbName} — ${it.status === "success" ? formatBytes(it.bytes) : it.error || "error"}`,
  }));
}

/** Texto plano del correo (alternativa al HTML), sin emojis. */
function buildText(n: BackupNotification): string {
  const parts = [`${EVENT_LABEL[n.event]}: ${n.jobName}`, EVENT_EMAIL[n.event].intro, ""];
  for (const r of summaryRows(n)) parts.push(`${r.label}: ${r.value}`);
  const det = detailItems(n);
  if (det) {
    parts.push("", "Detalle por base de datos:");
    for (const d of det) parts.push(`- [${d.ok ? "OK" : "ERROR"}] ${d.text}`);
  }
  return parts.join("\n");
}

/** Correo HTML con la plantilla de email-template.ts. */
function buildEmailHtml(n: BackupNotification): string {
  const ev = EVENT_EMAIL[n.event];
  const det = detailItems(n);
  return renderEmail({
    tone: ev.tone,
    status: ev.status,
    title: `${EVENT_LABEL[n.event]}: ${n.jobName}`,
    intro: ev.intro,
    rows: summaryRows(n).map(({ label, value }) => ({ label, value })),
    details: n.items && det
      ? n.items.map((it) => ({
          name: it.dbName,
          ok: it.status === "success",
          info: it.status === "success" ? formatBytes(it.bytes) : it.error || "error",
        }))
      : null,
    sentAt: sentAt(),
  });
}

/**
 * Mensaje de Telegram: HTML con etiquetas en negrita y `\n` como salto (su HTML no
 * admite `<br>`). Los valores dinámicos se escapan; etiquetas y emojis son estáticos.
 */
function buildTelegramHtml(n: BackupNotification): string {
  const br = "\n";
  const parts = [`<b>${escapeHtml(EVENT_HEAD[n.event])}</b>`, ""];
  for (const r of summaryRows(n)) parts.push(`${r.emoji} <b>${r.label}:</b> ${escapeHtml(r.value)}`);
  const det = detailItems(n);
  if (det) {
    parts.push("", "📋 <b>Detalle:</b>");
    for (const d of det) parts.push(`   ${d.emoji} ${escapeHtml(d.text)}`);
  }
  return parts.join(br);
}

/**
 * Envía el aviso de una corrida de backup por los canales habilitados (correo y/o
 * Telegram), según las banderas notifyOn*. **Nunca lanza**: cualquier fallo de un
 * canal se registra y no interrumpe el flujo de backups. Llamar en segundo plano.
 */
export async function notifyBackup(n: BackupNotification): Promise<void> {
  let cfg: NotifRuntimeConfig;
  try {
    cfg = await settings.getNotifRuntimeConfig();
  } catch (err) {
    logger.error({ err }, "No se pudo leer la configuración de notificaciones");
    return;
  }

  if (!eventEnabled(cfg, n.event)) return;

  const subject = `[DBKeeper] ${EVENT_LABEL[n.event]}: ${n.jobName}`;
  const text = buildText(n);

  const tasks: Promise<void>[] = [];

  if (cfg.email.enabled) {
    tasks.push(
      sendEmail(cfg.email, { subject, text, html: buildEmailHtml(n) }).catch((err) => {
        logger.error({ err, jobName: n.jobName, event: n.event }, "Fallo al enviar correo de notificación");
      }),
    );
  }

  if (cfg.telegram.enabled) {
    tasks.push(
      sendTelegram(cfg.telegram, buildTelegramHtml(n)).catch((err) => {
        logger.error({ err, jobName: n.jobName, event: n.event }, "Fallo al enviar notificación de Telegram");
      }),
    );
  }

  await Promise.all(tasks);
}

/** Resultado de un canal en el envío de prueba. `ok=null` = canal no habilitado. */
export interface ChannelTestResult {
  ok: boolean | null;
  error?: string;
}

export interface NotificationTestResult {
  email: ChannelTestResult;
  telegram: ChannelTestResult;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Envía un mensaje de prueba por cada canal habilitado y reporta el resultado de
 * cada uno (a diferencia de notifyBackup, aquí los errores se devuelven, no se
 * tragan). Ignora las banderas notifyOn*: solo importa que el canal esté habilitado.
 */
export async function sendTestNotification(): Promise<NotificationTestResult> {
  const cfg = await settings.getNotifRuntimeConfig();

  const subject = "[DBKeeper] Notificación de prueba";
  const head = "🔔 Notificación de prueba";
  const body = "Esta es una notificación de prueba de DBKeeper. Si la recibes, el canal está bien configurado.";
  const text = `Notificación de prueba\n\n${body}`;
  const emailHtml = renderEmail({ tone: "info", status: "Prueba", title: "Notificación de prueba", intro: body, sentAt: sentAt() });
  const telegramHtml = `<b>${escapeHtml(head)}</b>\n\n${escapeHtml(body)}`;

  const result: NotificationTestResult = {
    email: { ok: null },
    telegram: { ok: null },
  };

  const tasks: Promise<void>[] = [];

  if (cfg.email.enabled) {
    tasks.push(
      sendEmail(cfg.email, { subject, text, html: emailHtml })
        .then(() => {
          result.email = { ok: true };
        })
        .catch((err) => {
          result.email = { ok: false, error: errMessage(err) };
        }),
    );
  }

  if (cfg.telegram.enabled) {
    tasks.push(
      sendTelegram(cfg.telegram, telegramHtml)
        .then(() => {
          result.telegram = { ok: true };
        })
        .catch((err) => {
          result.telegram = { ok: false, error: errMessage(err) };
        }),
    );
  }

  await Promise.all(tasks);
  return result;
}
