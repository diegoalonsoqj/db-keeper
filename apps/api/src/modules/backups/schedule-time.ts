import { CronExpressionParser } from "cron-parser";
import { HttpError } from "../../lib/http-error.js";

/** Próximo disparo de un cron en una zona horaria, a partir de `from`. */
export function nextRunForCron(cron: string, timezone: string, from: Date): Date {
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
    return it.next().toDate();
  } catch {
    throw HttpError.badRequest("Expresión cron inválida");
  }
}

/** Offset (ms) de una zona IANA respecto a UTC en un instante dado. */
function tzOffsetMs(timezone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - at.getTime();
}

/**
 * Convierte una hora de pared local (ISO sin zona, p. ej. `2026-06-10T21:00`)
 * interpretada en `timezone`, al instante absoluto (UTC). Lanza si es inválida.
 */
export function zonedWallClockToInstant(localIso: string, timezone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso);
  if (!m) throw HttpError.badRequest("Fecha/hora inválida");
  const [, y, mo, d, h, mi] = m.map(Number);
  const guessUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  // El offset de la zona en ese instante aproximado basta salvo en el salto de DST.
  const offset = tzOffsetMs(timezone, new Date(guessUtc));
  return new Date(guessUtc - offset);
}
