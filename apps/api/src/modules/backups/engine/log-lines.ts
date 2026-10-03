import { StringDecoder } from "node:string_decoder";
import type { DumpLimits, StopReason } from "./supervise.js";

/** Tope de texto acumulado para el mensaje de error (no crece sin límite). */
const MAX_ACC = 8000;

/**
 * Codificación con que los clientes nativos C (`pg_dump`, `mysqldump`) emiten
 * texto en stderr. En Windows usan la codepage ANSI del sistema (Western/LatAm =
 * Windows-1252, equivalente a `latin1` en el rango que ocupan estos mensajes:
 * acentos y guillemets «»); en Linux/macOS emiten UTF-8. No aplica a `mongodump`
 * (binario Go), que emite UTF-8 en toda plataforma.
 */
export const NATIVE_CLIENT_STDERR_ENCODING: BufferEncoding =
  process.platform === "win32" ? "latin1" : "utf8";

/**
 * Lee un stream (stderr) por líneas y llama `onLine` por cada una (sin el salto).
 * Mantiene además un acumulado acotado del texto crudo para el mensaje de error.
 * Devuelve un getter de ese acumulado. Respeta líneas partidas entre chunks.
 */
export function pipeStderrLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  encoding: BufferEncoding = "utf8",
): () => string {
  const decoder = new StringDecoder(encoding);
  let buf = "";
  let acc = "";
  const emit = (line: string) => {
    const clean = line.replace(/\r$/, "");
    if (clean) onLine(clean);
  };
  stream.on("data", (chunk: Buffer) => {
    const text = decoder.write(chunk);
    // Se conserva el final: el error va al final (con --verbose, el principio son
    // cientos de líneas informativas).
    acc = (acc + text).slice(-MAX_ACC);
    buf += text;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      emit(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  });
  stream.on("end", () => {
    buf += decoder.end();
    if (buf) emit(buf);
  });
  return () => acc;
}

/**
 * Mensaje de un dump que terminó mal. Distingue el corte del supervisor (sin
 * avance o tope total: sin esto el mensaje era la última salida de --verbose, sin
 * ninguna pista) de otras señales y de los errores del cliente.
 */
export function describeDumpExit(e: {
  tool: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Por qué lo detuvo el supervisor (null = no lo detuvo él). */
  stopReason: StopReason | null;
  limits: DumpLimits;
  stderr: string;
}): string {
  const errors = summarizeErrorLines(e.stderr);
  if (e.stopReason) {
    const why =
      e.stopReason === "inactivity"
        ? `no avanzó en ${Math.round(e.limits.inactivityMs / 60_000)} min (ni creció el archivo ni hubo salida); se detuvo`
        : `superó la duración máxima por base (${Math.round(e.limits.maxMs / 3_600_000)} h); se detuvo`;
    return [`${e.tool} ${why}. Ajusta los tiempos en Configuración → Backups.`, errors].filter(Boolean).join("\n");
  }
  if (e.signal) {
    const hint = e.signal === "SIGKILL" ? " (posible falta de memoria en el servidor)" : "";
    return [`${e.tool} terminó por la señal ${e.signal}${hint}`, errors].filter(Boolean).join("\n");
  }
  return summarizeStderr(e.stderr) || `${e.tool} terminó con código ${e.code}`;
}

/** Solo las líneas de error reconocibles (sin caer al final del texto). */
function summarizeErrorLines(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && ERROR_LINE_RE.test(l))
    .slice(-20)
    .join("\n");
}

/** Líneas de error de los clientes: "pg_dump: error:/detail:/hint:", "mysqldump: Got error:", "Failed:". */
const ERROR_LINE_RE = /(^|\s)(error|fatal|failed|detail|hint)\s*:/i;

/**
 * Mensaje de error a partir del stderr de un dump fallido: solo las líneas de error
 * (sin la salida de --verbose); si no hay ninguna reconocible, el final del texto.
 */
export function summarizeStderr(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => ERROR_LINE_RE.test(l));
  return (errors.length > 0 ? errors.slice(-20) : lines.slice(-10)).join("\n");
}
