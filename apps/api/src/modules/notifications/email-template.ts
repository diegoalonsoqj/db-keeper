/**
 * Plantilla HTML de los correos de DBKeeper. Pensada para clientes de correo
 * (Outlook, Gmail): maquetación con tablas, estilos inline, sin imágenes ni CSS
 * externo. Todos los valores dinámicos se escapan aquí.
 */

export type EmailTone = "info" | "success" | "danger" | "warning";

export interface EmailRow {
  label: string;
  value: string;
}

export interface EmailDetail {
  name: string;
  ok: boolean;
  /** Tamaño si fue bien, motivo si falló. */
  info: string;
}

export interface EmailContent {
  tone: EmailTone;
  /** Etiqueta del estado (p. ej. "Completado"). */
  status: string;
  title: string;
  /** Vista previa que la bandeja muestra junto al asunto (no se ve en el cuerpo). */
  preheader?: string;
  intro?: string;
  rows?: EmailRow[];
  details?: EmailDetail[] | null;
  /** Fecha/hora ya formateada para el pie. */
  sentAt: string;
}

const TONES: Record<EmailTone, { fg: string; bg: string; bar: string }> = {
  info: { fg: "#1d4ed8", bg: "#eff6ff", bar: "#2563eb" },
  success: { fg: "#15803d", bg: "#f0fdf4", bar: "#16a34a" },
  danger: { fg: "#b91c1c", bg: "#fef2f2", bar: "#dc2626" },
  warning: { fg: "#b45309", bg: "#fffbeb", bar: "#d97706" },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rowsTable(rows: EmailRow[]): string {
  const trs = rows
    .map(
      (r, i) => `<tr>
<td style="padding:10px 0;${i ? `border-top:1px solid ${BORDER};` : ""}color:${MUTED};font-size:13px;width:38%;vertical-align:top">${escapeHtml(r.label)}</td>
<td style="padding:10px 0;${i ? `border-top:1px solid ${BORDER};` : ""}color:${TEXT};font-size:14px;font-weight:600;word-break:break-word">${escapeHtml(r.value)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${trs}</table>`;
}

function detailsTable(details: EmailDetail[]): string {
  const th = (t: string, align = "left"): string =>
    `<th align="${align}" style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap">${t}</th>`;
  const trs = details
    .map((d) => {
      const tone = TONES[d.ok ? "success" : "danger"];
      return `<tr>
<td style="padding:10px 12px;border-bottom:1px solid ${BORDER};color:${TEXT};font-size:14px;font-weight:600;word-break:break-word">${escapeHtml(d.name)}</td>
<td style="padding:10px 12px;border-bottom:1px solid ${BORDER};white-space:nowrap"><span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:600">${d.ok ? "Correcto" : "Error"}</span></td>
<td style="padding:10px 12px;border-bottom:1px solid ${BORDER};color:${d.ok ? TEXT : tone.fg};font-size:13px;word-break:break-word">${escapeHtml(d.info)}</td>
</tr>`;
    })
    .join("");
  return `<p style="margin:28px 0 10px;color:${TEXT};font-size:15px;font-weight:600">Detalle por base de datos</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${BORDER};border-radius:8px">
<tr>${th("Base de datos")}${th("Estado")}${th("Tamaño / motivo")}</tr>${trs}</table>`;
}

/**
 * Texto oculto al inicio del cuerpo: los clientes lo usan como vista previa. El
 * relleno de espacios invisibles evita que la vista previa siga con el texto del cuerpo.
 */
function preheaderBlock(text: string): string {
  return `<div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(text)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`;
}

/** Documento HTML completo del correo. */
export function renderEmail(c: EmailContent): string {
  const tone = TONES[c.tone];
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${FONT}">
${c.preheader ? preheaderBlock(c.preheader) : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;overflow:hidden">
<tr><td style="height:4px;background:${tone.bar};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="color:${TEXT};font-size:15px;font-weight:700;letter-spacing:.02em">DBKeeper</td>
<td align="right"><span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size:12px;font-weight:600">${escapeHtml(c.status)}</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:20px 32px 8px">
<h1 style="margin:0;color:${TEXT};font-size:22px;line-height:1.3;font-weight:700">${escapeHtml(c.title)}</h1>
${c.intro ? `<p style="margin:10px 0 0;color:${MUTED};font-size:14px;line-height:1.6">${escapeHtml(c.intro)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 32px 32px">
${c.rows?.length ? rowsTable(c.rows) : ""}
${c.details?.length ? detailsTable(c.details) : ""}
</td></tr>
<tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;line-height:1.5">
Mensaje automático de DBKeeper · ${escapeHtml(c.sentAt)}<br>No responder a este correo.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
