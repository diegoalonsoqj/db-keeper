import { executionCode } from "@dbkeeper/shared";
import { logger } from "../../config/logger.js";
import { findNotifyModeForExecution } from "../groups/group-runs.repository.js";
import { formatBytes } from "../../lib/format.js";
import * as settings from "../settings/settings.service.js";
import type { NotifRuntimeConfig } from "../settings/settings.service.js";
import { sendEmail } from "./email.js";
import { escapeHtml, renderEmail, type EmailTone } from "./email-template.js";
import * as repo from "./notifications.repository.js";
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
  /** Ejecución a la que pertenece el aviso: define el hilo (asunto, SMTP, Telegram). */
  executionId: string;
  /** Fecha de la ejecución (creación): la misma en todos sus avisos aunque termine otro día. */
  runAt: Date;
  /** Nombre de la instancia (null si ya no existe). */
  instance?: string | null;
  /** Grupo que lanzó la ejecución (null si se lanzó sola). */
  group?: string | null;
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

/** Etiqueta corta (sin emoji) del evento, para el título del cuerpo. */
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
  const rows: { emoji: string; label: string; value: string }[] = [];
  if (n.group) rows.push({ emoji: "📚", label: "Grupo", value: n.group });
  rows.push({ emoji: "🏷️", label: "Evento", value: n.jobName });
  if (n.instance) rows.push({ emoji: "🖥️", label: "Instancia", value: n.instance });
  rows.push({ emoji: "🔖", label: "Ejecución", value: `#${executionCode(n.executionId)}` });
  rows.push({ emoji: "🗄️", label: "Motor", value: engineLabel(n.engine) });
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

/**
 * Asunto fijo por ejecución (sin estado) para que inicio, fin e integridad queden en
 * un mismo hilo: `[DBKeeper] [<grupo>] <instancia> · <evento> · <fecha> · #<código>`.
 * El grupo solo si lo lanzó uno; la instancia se omite si el nombre del evento ya la
 * contiene (p. ej. "BK - <instancia>").
 */
export function backupSubject(
  n: Pick<BackupNotification, "executionId" | "runAt" | "instance" | "jobName" | "group">,
): string {
  const showInstance = n.instance && !n.jobName.toLowerCase().includes(n.instance.toLowerCase());
  const date = n.runAt.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
  const group = n.group ? `[${n.group}] ` : "";
  return `[DBKeeper] ${group}${showInstance ? `${n.instance} · ` : ""}${n.jobName} · ${date} · #${executionCode(n.executionId)}`;
}

/** Estado en una línea: vista previa del correo en la bandeja (el asunto no lo lleva). */
export function statusLine(n: BackupNotification): string {
  const status = EVENT_EMAIL[n.event].status;
  const items = n.items ?? [];
  const failed = items.filter((i) => i.status === "failed").map((i) => i.dbName);
  const names = (list: string[]): string => (list.length > 3 ? `${list.slice(0, 3).join(", ")}…` : list.join(", "));
  switch (n.event) {
    case "start":
      return `${status} — ${n.databases.length} ${n.databases.length === 1 ? "base de datos" : "bases de datos"}`;
    case "success":
      return `${status} — ${items.length || n.databases.length} BD, ${formatBytes(n.totalBytes)} en ${formatDuration(n.durationMs)}`;
    case "failure":
      return failed.length
        ? `${status} — ${failed.length} de ${items.length} BD ${failed.length === 1 ? "falló" : "fallaron"} (${names(failed)})`
        : status;
    case "integrity":
      return `${status} — archivo alterado o faltante: ${names(n.databases)}`;
  }
}

/** Texto plano del correo (alternativa al HTML), sin emojis. */
function buildText(n: BackupNotification): string {
  const parts = [statusLine(n), "", `${EVENT_LABEL[n.event]}: ${n.jobName}`, EVENT_EMAIL[n.event].intro, ""];
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
    preheader: statusLine(n),
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
 * ¿Sale el aviso individual de un evento lanzado por un grupo? Lo decide el modo de
 * la corrida (el resumen final va aparte). Ante un error de lectura, se envía.
 */
async function groupAllows(n: BackupNotification): Promise<boolean> {
  if (!n.group || n.event === "integrity") return true;
  const mode = await findNotifyModeForExecution(n.executionId).catch((err) => {
    logger.warn({ err, executionId: n.executionId }, "No se pudo leer el modo de avisos del grupo");
    return null;
  });
  if (mode === "summary") return false;
  if (mode === "summary_failures") return n.event === "failure";
  return true; // 'all' o ejecución anterior a las corridas de grupo
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
  if (!(await groupAllows(n))) return;

  const subject = backupSubject(n);
  const text = buildText(n);

  const tasks: Promise<void>[] = [];

  if (cfg.email.enabled) {
    tasks.push(
      sendEmail(cfg.email, { subject, text, html: buildEmailHtml(n), threadId: `dbkeeper-exec-${n.executionId}` }).catch((err) => {
        logger.error({ err, jobName: n.jobName, event: n.event }, "Fallo al enviar correo de notificación");
      }),
    );
  }

  if (cfg.telegram.enabled) {
    tasks.push(
      sendTelegramThreaded(cfg.telegram, n.executionId, buildTelegramHtml(n)).catch((err) => {
        logger.error({ err, jobName: n.jobName, event: n.event }, "Fallo al enviar notificación de Telegram");
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Envíos de Telegram en curso por ejecución: se encadenan para que el aviso de fin
 * espere a que el de inicio guarde su id (en un backup rápido ambos salen casi juntos).
 */
const telegramChains = new Map<string, Promise<void>>();

/**
 * Telegram en hilo: el primer aviso de la ejecución queda como raíz (se guarda su id)
 * y los siguientes se envían como respuesta a él, aunque lleguen días después.
 */
function sendTelegramThreaded(cfg: NotifRuntimeConfig["telegram"], executionId: string, html: string): Promise<void> {
  const prev = telegramChains.get(executionId) ?? Promise.resolve();
  const run = prev.then(async () => {
    const root = await repo.findTelegramRoot(executionId).catch((err) => {
      logger.warn({ err, executionId }, "No se pudo leer el hilo de Telegram de la ejecución");
      return null;
    });
    const replyTo = root && root.chatId === cfg.chatId ? root.messageId : null;
    const messageId = await sendTelegram(cfg, html, replyTo);
    if (messageId && !replyTo) await repo.saveTelegramRoot(executionId, cfg.chatId, messageId);
  });
  const settled = run.catch(() => {});
  telegramChains.set(executionId, settled);
  void settled.then(() => {
    if (telegramChains.get(executionId) === settled) telegramChains.delete(executionId);
  });
  return run;
}

// ---- Corrida de grupo: aviso de inicio y resumen final ----

/** Línea de un evento en el aviso del grupo. */
export interface GroupRunEventLine {
  executionId?: string;
  name: string;
  /** En el aviso de inicio, `queued` (en cola) u `skipped`. */
  status: "queued" | "success" | "failed" | "skipped";
  durationMs?: number | null;
  dbCount?: number;
  totalBytes?: number;
  /** Motivo ya recortado (solo si falló). */
  error?: string | null;
}

export interface GroupRunNotification {
  event: "start" | "summary";
  runId: string;
  group: string;
  runAt: Date;
  /** Solo resumen. */
  durationMs?: number | null;
  events: GroupRunEventLine[];
}

type GroupOutcome = "start" | "success" | "partial" | "failure";

function groupOutcome(n: GroupRunNotification): GroupOutcome {
  if (n.event === "start") return "start";
  const ran = n.events.filter((e) => e.status === "success" || e.status === "failed");
  const failed = ran.filter((e) => e.status === "failed").length;
  if (failed === 0) return "success";
  return failed === ran.length ? "failure" : "partial";
}

const GROUP_OUTCOME: Record<GroupOutcome, { tone: EmailTone; status: string; label: string; head: string; intro: string }> = {
  start: {
    tone: "info",
    status: "En curso",
    label: "Grupo iniciado",
    head: "🚀 Grupo iniciado",
    intro: "Se lanzó el grupo de eventos de backup.",
  },
  success: {
    tone: "success",
    status: "Completado",
    label: "Grupo completado",
    head: "✅ Grupo completado",
    intro: "Todos los eventos del grupo terminaron correctamente.",
  },
  partial: {
    tone: "danger",
    status: "Con fallos",
    label: "Grupo con fallos",
    head: "⚠️ Grupo con fallos",
    intro: "Algunos eventos del grupo fallaron. Revisa el detalle y el log de cada ejecución en DBKeeper.",
  },
  failure: {
    tone: "danger",
    status: "Fallido",
    label: "Grupo fallido",
    head: "❌ Grupo fallido",
    intro: "Todos los eventos del grupo fallaron. Revisa el detalle y el log de cada ejecución en DBKeeper.",
  },
};

/** Asunto fijo por corrida: inicio y resumen quedan en el mismo hilo de correo. */
export function groupRunSubject(n: Pick<GroupRunNotification, "runId" | "group" | "runAt">): string {
  const date = n.runAt.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `[DBKeeper] [${n.group}] Grupo · ${date} · #${executionCode(n.runId)}`;
}

function groupCounts(n: GroupRunNotification): Record<GroupRunEventLine["status"], number> {
  const c = { queued: 0, success: 0, failed: 0, skipped: 0 };
  for (const e of n.events) c[e.status]++;
  return c;
}

const plural = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

/** Estado en una línea (vista previa del correo). */
export function groupStatusLine(n: GroupRunNotification): string {
  const o = GROUP_OUTCOME[groupOutcome(n)];
  const c = groupCounts(n);
  const skipped = c.skipped ? ` · ${plural(c.skipped, "omitido", "omitidos")}` : "";
  if (n.event === "start") return `${o.status} — ${plural(c.queued, "evento", "eventos")} en cola${skipped}`;
  return `${o.status} — ${c.success} OK · ${plural(c.failed, "fallido", "fallidos")}${skipped} · ${formatDuration(n.durationMs)}`;
}

/** Detalle de un evento (sin emoji). */
function groupEventInfo(e: GroupRunEventLine): string {
  switch (e.status) {
    case "skipped":
      return "Omitido: evento inactivo o sin bases de datos";
    case "queued":
      return `En cola · ${e.dbCount ?? 0} BD`;
    case "failed":
      return `Error: ${e.error || "error"}`;
    case "success":
      return `${formatDuration(e.durationMs)} · ${e.dbCount ?? 0} BD · ${formatBytes(e.totalBytes)}`;
  }
}

const GROUP_EVENT_EMOJI: Record<GroupRunEventLine["status"], string> = {
  queued: "⏳",
  success: "✅",
  failed: "❌",
  skipped: "⏭️",
};

const GROUP_EVENT_TAG: Record<GroupRunEventLine["status"], string> = {
  queued: "EN COLA",
  success: "OK",
  failed: "ERROR",
  skipped: "OMITIDO",
};

function groupRows(n: GroupRunNotification): { emoji: string; label: string; value: string }[] {
  const c = groupCounts(n);
  const rows = [
    { emoji: "📚", label: "Grupo", value: n.group },
    { emoji: "🔖", label: "Corrida", value: `#${executionCode(n.runId)}` },
  ];
  if (n.event === "start") {
    rows.push({ emoji: "📋", label: "Eventos en cola", value: String(c.queued) });
  } else {
    rows.push({ emoji: "⏱️", label: "Duración", value: formatDuration(n.durationMs) });
    rows.push({ emoji: "📊", label: "Resultado", value: `${c.success} OK · ${plural(c.failed, "fallido", "fallidos")}` });
  }
  if (c.skipped) rows.push({ emoji: "⏭️", label: "Omitidos", value: String(c.skipped) });
  return rows;
}

function buildGroupText(n: GroupRunNotification): string {
  const o = GROUP_OUTCOME[groupOutcome(n)];
  const parts = [groupStatusLine(n), "", `${o.label}: ${n.group}`, o.intro, ""];
  for (const r of groupRows(n)) parts.push(`${r.label}: ${r.value}`);
  parts.push("", "Eventos:");
  for (const e of n.events) parts.push(`- [${GROUP_EVENT_TAG[e.status]}] ${e.name} — ${groupEventInfo(e)}`);
  return parts.join("\n");
}

function buildGroupEmailHtml(n: GroupRunNotification): string {
  const o = GROUP_OUTCOME[groupOutcome(n)];
  return renderEmail({
    tone: o.tone,
    status: o.status,
    title: `${o.label}: ${n.group}`,
    preheader: groupStatusLine(n),
    intro: o.intro,
    rows: groupRows(n).map(({ label, value }) => ({ label, value })),
    details: n.events.map((e) => ({
      name: e.name,
      ok: e.status === "success",
      skipped: e.status === "skipped" || e.status === "queued",
      info: groupEventInfo(e),
    })),
    detailsTitle: "Detalle por evento",
    detailsNameHeader: "Evento",
    sentAt: sentAt(),
  });
}

/** Telegram rechaza mensajes de más de 4096 caracteres. */
const TELEGRAM_MAX = 4000;

function buildGroupTelegramHtml(n: GroupRunNotification): string {
  const o = GROUP_OUTCOME[groupOutcome(n)];
  const head = [`<b>${escapeHtml(o.head)}</b>`, ""];
  for (const r of groupRows(n)) head.push(`${r.emoji} <b>${r.label}:</b> ${escapeHtml(r.value)}`);
  head.push("", "📋 <b>Eventos:</b>");
  let html = head.join("\n");
  // Se corta por líneas completas para no partir una etiqueta HTML.
  for (let i = 0; i < n.events.length; i++) {
    const e = n.events[i]!;
    const line = `\n   ${GROUP_EVENT_EMOJI[e.status]} <b>${escapeHtml(e.name)}</b> — ${escapeHtml(groupEventInfo(e))}`;
    if (html.length + line.length > TELEGRAM_MAX) {
      html += `\n   … y ${n.events.length - i} más (ver DBKeeper)`;
      break;
    }
    html += line;
  }
  return html;
}

/**
 * Aviso de inicio o resumen final de una corrida de grupo. El resumen respeta las
 * banderas de éxito/fallo de Configuración; el inicio lo decide el grupo (notifyStart).
 * **Nunca lanza.**
 */
export async function notifyGroupRun(n: GroupRunNotification): Promise<void> {
  let cfg: NotifRuntimeConfig;
  try {
    cfg = await settings.getNotifRuntimeConfig();
  } catch (err) {
    logger.error({ err }, "No se pudo leer la configuración de notificaciones");
    return;
  }
  const outcome = groupOutcome(n);
  if (outcome === "success" && !cfg.notifyOnSuccess) return;
  if ((outcome === "partial" || outcome === "failure") && !cfg.notifyOnFailure) return;

  const tasks: Promise<void>[] = [];
  if (cfg.email.enabled) {
    tasks.push(
      sendEmail(cfg.email, {
        subject: groupRunSubject(n),
        text: buildGroupText(n),
        html: buildGroupEmailHtml(n),
        threadId: `dbkeeper-group-${n.runId}`,
      }).catch((err) => {
        logger.error({ err, group: n.group, event: n.event }, "Fallo al enviar correo del grupo");
      }),
    );
  }
  if (cfg.telegram.enabled) {
    tasks.push(
      sendTelegram(cfg.telegram, buildGroupTelegramHtml(n)).then(
        () => {},
        (err) => {
          logger.error({ err, group: n.group, event: n.event }, "Fallo al enviar Telegram del grupo");
        },
      ),
    );
  }
  await Promise.all(tasks);
}

// ---- Vigilancia: eventos sin backup correcto tras su disparo ----

/** Evento atrasado: su último disparo pasó el margen sin un backup correcto. */
export interface StaleJob {
  jobName: string;
  /** Disparo programado que no produjo backup. */
  expectedAt: Date;
  /** Último backup correcto (null = nunca). */
  lastSuccessAt: Date | null;
}

const shortDate = (d: Date): string => d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });

/** "hace 2 d 5 h" / "hace 40 min". */
export function ago(from: Date, now = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

function staleInfo(j: StaleJob): string {
  const last = j.lastSuccessAt ? `${shortDate(j.lastSuccessAt)} (${ago(j.lastSuccessAt)})` : "nunca";
  return `Programado ${shortDate(j.expectedAt)} · último correcto: ${last}`;
}

const STALE_INTRO = (hours: number): string =>
  `Estos eventos no tienen un backup correcto ${hours} h después de su último disparo programado: no se ejecutaron, no terminaron o fallaron. Revisa el scheduler, la cola y las ejecuciones en DBKeeper.`;

/**
 * Aviso de eventos atrasados (un mensaje con todos). Respeta la bandera de fallos de
 * Configuración. **Nunca lanza.**
 */
export async function notifyStaleJobs(jobs: StaleJob[], graceHours: number): Promise<void> {
  if (jobs.length === 0) return;
  let cfg: NotifRuntimeConfig;
  try {
    cfg = await settings.getNotifRuntimeConfig();
  } catch (err) {
    logger.error({ err }, "No se pudo leer la configuración de notificaciones");
    return;
  }
  if (!cfg.notifyOnFailure) return;

  const count = jobs.length === 1 ? "1 evento" : `${jobs.length} eventos`;
  const title = `Backups atrasados: ${count}`;
  const tasks: Promise<void>[] = [];
  if (cfg.email.enabled) {
    const text = [title, "", STALE_INTRO(graceHours), "", ...jobs.map((j) => `- ${j.jobName} — ${staleInfo(j)}`)].join("\n");
    const html = renderEmail({
      tone: "warning",
      status: "Atrasado",
      title,
      preheader: jobs.map((j) => j.jobName).join(", "),
      intro: STALE_INTRO(graceHours),
      details: jobs.map((j) => ({ name: j.jobName, ok: false, skipped: true, info: staleInfo(j) })),
      detailsTitle: "Eventos atrasados",
      detailsNameHeader: "Evento",
      sentAt: sentAt(),
    });
    tasks.push(
      sendEmail(cfg.email, { subject: `[DBKeeper] ${title}`, text, html }).catch((err) => {
        logger.error({ err }, "Fallo al enviar correo de backups atrasados");
      }),
    );
  }
  if (cfg.telegram.enabled) {
    let msg = `<b>⏰ ${escapeHtml(title)}</b>\n\n${escapeHtml(STALE_INTRO(graceHours))}\n`;
    for (let i = 0; i < jobs.length; i++) {
      const line = `\n⚠️ <b>${escapeHtml(jobs[i]!.jobName)}</b>\n   ${escapeHtml(staleInfo(jobs[i]!))}`;
      if (msg.length + line.length > TELEGRAM_MAX) {
        msg += `\n… y ${jobs.length - i} más (ver DBKeeper)`;
        break;
      }
      msg += line;
    }
    tasks.push(
      sendTelegram(cfg.telegram, msg).then(
        () => {},
        (err) => {
          logger.error({ err }, "Fallo al enviar Telegram de backups atrasados");
        },
      ),
    );
  }
  await Promise.all(tasks);
}

// ---- Vigilancia: poco espacio en el disco de backups ----

/** Espacio del disco de backups para el aviso. */
export interface DiskLowInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  freePct: number;
}

/** Aviso de poco espacio libre. Respeta la bandera de fallos. **Nunca lanza.** */
export async function notifyDiskLow(d: DiskLowInfo, thresholdPct: number): Promise<void> {
  let cfg: NotifRuntimeConfig;
  try {
    cfg = await settings.getNotifRuntimeConfig();
  } catch (err) {
    logger.error({ err }, "No se pudo leer la configuración de notificaciones");
    return;
  }
  if (!cfg.notifyOnFailure) return;

  const pct = `${d.freePct.toFixed(1)} %`;
  const title = `Poco espacio en el disco de backups: ${pct} libre`;
  const intro =
    `El espacio libre bajó del ${thresholdPct} %. Si se llena, los próximos backups fallarán. ` +
    "Revisa la retención de los eventos (Conservar últimos N) o la retención por defecto en Configuración → Backups.";
  const rows = [
    { emoji: "📁", label: "Ruta", value: d.path },
    { emoji: "💽", label: "Libre", value: `${formatBytes(d.freeBytes)} (${pct})` },
    { emoji: "📦", label: "Total", value: formatBytes(d.totalBytes) },
  ];

  const tasks: Promise<void>[] = [];
  if (cfg.email.enabled) {
    const text = [title, "", intro, "", ...rows.map((r) => `${r.label}: ${r.value}`)].join("\n");
    const html = renderEmail({
      tone: "warning",
      status: "Disco",
      title,
      preheader: `${pct} libre en ${d.path}`,
      intro,
      rows: rows.map(({ label, value }) => ({ label, value })),
      sentAt: sentAt(),
    });
    tasks.push(
      sendEmail(cfg.email, { subject: `[DBKeeper] ${title}`, text, html }).catch((err) => {
        logger.error({ err }, "Fallo al enviar correo de poco espacio en disco");
      }),
    );
  }
  if (cfg.telegram.enabled) {
    const parts = [`<b>💽 ${escapeHtml(title)}</b>`, "", escapeHtml(intro), ""];
    for (const r of rows) parts.push(`${r.emoji} <b>${r.label}:</b> ${escapeHtml(r.value)}`);
    tasks.push(
      sendTelegram(cfg.telegram, parts.join("\n")).then(
        () => {},
        (err) => {
          logger.error({ err }, "Fallo al enviar Telegram de poco espacio en disco");
        },
      ),
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
