import { logger } from "../../config/logger.js";
import * as settings from "../settings/settings.service.js";
import type { NotifRuntimeConfig } from "../settings/settings.service.js";
import { sendEmail } from "./email.js";
import { sendTelegram } from "./telegram.js";

export type BackupEvent = "start" | "success" | "failure";

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
  /** Solo para eventos de fin (success/failure). */
  durationMs?: number | null;
  totalBytes?: number | null;
  items?: BackupItemResult[];
}

const EVENT_LABEL: Record<BackupEvent, string> = {
  start: "Backup iniciado",
  success: "Backup completado",
  failure: "Backup con errores",
};

function eventEnabled(cfg: NotifRuntimeConfig, event: BackupEvent): boolean {
  if (event === "start") return cfg.notifyOnStart;
  if (event === "success") return cfg.notifyOnSuccess;
  return cfg.notifyOnFailure;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Líneas de resumen comunes (texto plano), una por elemento. */
function summaryLines(n: BackupNotification): string[] {
  const lines = [
    `Evento: ${n.jobName}`,
    `Motor: ${n.engine}`,
  ];
  if (n.environment) lines.push(`Ambiente: ${n.environment}`);
  lines.push(`Bases de datos: ${n.databases.join(", ") || "—"}`);
  if (n.event !== "start") {
    lines.push(`Duración: ${formatDuration(n.durationMs)}`);
    lines.push(`Peso total: ${formatBytes(n.totalBytes)}`);
  }
  if (n.items && n.items.length > 0 && n.event !== "start") {
    lines.push("Detalle:");
    for (const it of n.items) {
      const mark = it.status === "success" ? "OK" : "FALLÓ";
      const extra = it.status === "success" ? formatBytes(it.bytes) : it.error || "error";
      lines.push(`  - ${it.dbName}: ${mark} (${extra})`);
    }
  }
  return lines;
}

function buildText(n: BackupNotification): string {
  return [`${EVENT_LABEL[n.event]}`, "", ...summaryLines(n)].join("\n");
}

function buildHtml(n: BackupNotification): string {
  const rows = summaryLines(n).map((l) => escapeHtml(l)).join("<br>");
  return `<b>${escapeHtml(EVENT_LABEL[n.event])}</b><br><br>${rows}`;
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
  const html = buildHtml(n);

  const tasks: Promise<void>[] = [];

  if (cfg.email.enabled) {
    tasks.push(
      sendEmail(cfg.email, { subject, text, html }).catch((err) => {
        logger.error({ err, jobName: n.jobName, event: n.event }, "Fallo al enviar correo de notificación");
      }),
    );
  }

  if (cfg.telegram.enabled) {
    tasks.push(
      sendTelegram(cfg.telegram, text).catch((err) => {
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
  const body = "Esta es una notificación de prueba de DBKeeper. Si la recibes, el canal está bien configurado.";
  const text = `${subject}\n\n${body}`;
  const html = `<b>${escapeHtml(subject)}</b><br><br>${escapeHtml(body)}`;

  const result: NotificationTestResult = {
    email: { ok: null },
    telegram: { ok: null },
  };

  const tasks: Promise<void>[] = [];

  if (cfg.email.enabled) {
    tasks.push(
      sendEmail(cfg.email, { subject, text, html })
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
      sendTelegram(cfg.telegram, text)
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
