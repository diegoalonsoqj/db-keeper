/**
 * Log persistido de una BD (`execution_items.log`): cada línea con su hora y, si
 * supera el tope, se conservan el principio y el final con una marca intermedia.
 * El final importa: ahí van el SHA-256, la subida y la verificación de integridad.
 */

/** Líneas que se guardan del principio y del final. */
const HEAD_LINES = 1000;
const TAIL_LINES = 1000;
/** Tope de texto guardado (caracteres). */
export const MAX_LOG_CHARS = 64_000;

const pad = (n: number): string => String(n).padStart(2, "0");

/** "HH:MM:SS" en la zona horaria del proceso. */
export function clock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const omittedMark = (n: number): string => `… ${n} ${n === 1 ? "línea omitida" : "líneas omitidas"} …`;

export interface LogBuffer {
  /** Agrega una línea con la hora actual y la devuelve ya formateada. */
  push: (line: string) => string;
  /** Texto a persistir (null si vacío). */
  text: () => string | null;
}

/**
 * `initial`: log ya persistido (al retomar), que ya trae sus horas y su marca de
 * recorte si la tuvo; se conserva tal cual al principio.
 */
export function createLogBuffer(initial: string | null = null, now: () => Date = () => new Date()): LogBuffer {
  const head: string[] = initial ? initial.split("\n") : [];
  let tail: string[] = [];
  let omitted = 0;

  return {
    push(line) {
      const stamped = `${clock(now())} ${line}`;
      if (head.length < HEAD_LINES) head.push(stamped);
      else {
        tail.push(stamped);
        // Recorte por lotes: evita un shift() por línea en dumps muy verbosos.
        if (tail.length >= TAIL_LINES * 2) {
          omitted += tail.length - TAIL_LINES;
          tail = tail.slice(-TAIL_LINES);
        }
      }
      return stamped;
    },
    text() {
      let t = tail;
      let dropped = omitted;
      if (t.length > TAIL_LINES) {
        dropped += t.length - TAIL_LINES;
        t = t.slice(-TAIL_LINES);
      }
      return fit(head, t, dropped);
    },
  };
}

/** Une principio y final dentro de MAX_LOG_CHARS, quitando líneas del medio si hace falta. */
function fit(head: string[], tail: string[], dropped: number): string | null {
  const len = (ls: string[]): number => ls.reduce((s, l) => s + l.length + 1, 0);
  let h = head.length;
  let t = 0; // líneas quitadas del inicio del final
  let hSize = len(head);
  let tSize = len(tail);
  const over = (): boolean => hSize + tSize + (dropped ? 40 : 0) > MAX_LOG_CHARS;
  // El final se protege: primero se acorta el principio hasta la mitad del tope.
  while (over() && h > 0 && hSize > MAX_LOG_CHARS / 2) {
    hSize -= head[--h]!.length + 1;
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
  const keptHead = head.slice(0, h);
  const keptTail = tail.slice(t);
  const lines = dropped > 0 ? [...keptHead, omittedMark(dropped), ...keptTail] : [...keptHead, ...keptTail];
  // Una sola línea gigante: se corta para respetar el tope igualmente.
  const out = lines.join("\n").slice(0, MAX_LOG_CHARS);
  return out || null;
}
