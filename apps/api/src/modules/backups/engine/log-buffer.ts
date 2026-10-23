/**
 * Log persistido de una BD (`execution_items.log`): cada línea con su hora y, si
 * supera el tope, se conservan el principio y el final con una marca intermedia.
 * El final importa: ahí van el SHA-256, la subida y la verificación de integridad.
 * Del medio omitido se rescatan las líneas con error o aviso (con su propio tope),
 * para que un fallo a mitad del dump no desaparezca del resumen.
 */

/** Líneas que se guardan del principio y del final. */
const HEAD_LINES = 1000;
const TAIL_LINES = 1000;
/** Tope de texto guardado (caracteres). */
export const MAX_LOG_CHARS = 64_000;
/** Tope de líneas con error rescatadas del medio, en líneas y caracteres. */
const MAX_ERROR_LINES = 200;
const MAX_ERROR_CHARS = 8_000;

/** Línea con error o aviso (mensajes de pg_dump, mysqldump, mongodump, sqlcmd y propios). */
const ERROR_RE = /\b(error|errors|fatal|fail(ed|ure)?|denied|warn(ing)?|exception|panic)\b|\bfall[óo]|\bmsg \d+, level (1[1-9]|2\d)\b/i;

export const isErrorLine = (line: string): boolean => ERROR_RE.test(line);

const pad = (n: number): string => String(n).padStart(2, "0");

/** "HH:MM:SS" en la zona horaria del proceso. */
export function clock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const omittedMark = (n: number, kept: number, seen: number): string => {
  const base = `${n} ${n === 1 ? "línea omitida" : "líneas omitidas"}`;
  if (!seen) return `… ${base} …`;
  const of = seen > kept ? `${kept} de ${seen}` : `${kept}`;
  return `… ${base}; se conservan abajo ${of} con error o aviso …`;
};
/** Cierra el bloque de errores rescatados: lo que sigue ya es el final contiguo. */
const END_ERRORS_MARK = "…";

export interface LogBuffer {
  /** Agrega una línea con la hora actual y la devuelve ya formateada. */
  push: (line: string) => string;
  /** Texto a persistir (null si vacío). */
  text: () => string | null;
}

/** Líneas con error rescatadas del medio. */
interface Rescued {
  lines: string[];
  chars: number;
  /** Líneas con error vistas en el medio, rescatadas o no. */
  seen: number;
}

/** Rescata del lote omitido las líneas con error que quepan; devuelve cuántas omite. */
function rescue(dropped: string[], r: Rescued): number {
  let omitted = 0;
  for (const l of dropped) {
    if (!isErrorLine(l)) {
      omitted++;
      continue;
    }
    r.seen++;
    if (r.lines.length < MAX_ERROR_LINES && r.chars + l.length + 1 <= MAX_ERROR_CHARS) {
      r.lines.push(l);
      r.chars += l.length + 1;
    } else omitted++;
  }
  return omitted;
}

/**
 * `initial`: log ya persistido (al retomar), que ya trae sus horas y su marca de
 * recorte si la tuvo; se conserva tal cual al principio.
 */
export function createLogBuffer(initial: string | null = null, now: () => Date = () => new Date()): LogBuffer {
  const head: string[] = initial ? initial.split("\n") : [];
  let tail: string[] = [];
  let omitted = 0;
  const rescued: Rescued = { lines: [], chars: 0, seen: 0 };

  return {
    push(line) {
      const stamped = `${clock(now())} ${line}`;
      if (head.length < HEAD_LINES) head.push(stamped);
      else {
        tail.push(stamped);
        // Recorte por lotes: evita un shift() por línea en dumps muy verbosos.
        if (tail.length >= TAIL_LINES * 2) {
          omitted += rescue(tail.slice(0, tail.length - TAIL_LINES), rescued);
          tail = tail.slice(-TAIL_LINES);
        }
      }
      return stamped;
    },
    text() {
      let t = tail;
      let dropped = omitted;
      const r: Rescued = { lines: [...rescued.lines], chars: rescued.chars, seen: rescued.seen };
      if (t.length > TAIL_LINES) {
        dropped += rescue(t.slice(0, t.length - TAIL_LINES), r);
        t = t.slice(-TAIL_LINES);
      }
      return fit(head, r, t, dropped);
    },
  };
}

/**
 * Une principio, errores rescatados y final dentro de MAX_LOG_CHARS, quitando líneas
 * si hace falta. Prioridad al recortar: final > errores > principio.
 */
function fit(head: string[], r: Rescued, tail: string[], dropped: number): string | null {
  const len = (ls: string[]): number => ls.reduce((s, l) => s + l.length + 1, 0);
  const errors = r.lines;
  let h = head.length;
  let e = errors.length; // errores conservados (se quitan los últimos)
  let t = 0; // líneas quitadas del inicio del final
  let hSize = len(head);
  let eSize = r.chars;
  let tSize = len(tail);
  const marks = (): number => (dropped || r.seen ? 120 : 0);
  const over = (): boolean => hSize + eSize + tSize + marks() > MAX_LOG_CHARS;
  // El final se protege: primero se acorta el principio hasta la mitad del tope.
  while (over() && h > 0 && hSize > MAX_LOG_CHARS / 2) {
    hSize -= head[--h]!.length + 1;
    dropped++;
  }
  while (over() && e > 0) {
    eSize -= errors[--e]!.length + 1;
    dropped++;
  }
  while (over() && t < tail.length) {
    tSize -= tail[t++]!.length + 1;
    dropped++;
  }
  while (over() && h > 0) {
    hSize -= head[--h]!.length + 1;
    dropped++;
  }
  const keptErrors = errors.slice(0, e);
  const middle =
    keptErrors.length > 0
      ? [omittedMark(dropped, keptErrors.length, r.seen), ...keptErrors, END_ERRORS_MARK]
      : dropped > 0
        ? [omittedMark(dropped, 0, 0)]
        : [];
  const lines = [...head.slice(0, h), ...middle, ...tail.slice(t)];
  // Una sola línea gigante: se corta para respetar el tope igualmente.
  const out = lines.join("\n").slice(0, MAX_LOG_CHARS);
  return out || null;
}
