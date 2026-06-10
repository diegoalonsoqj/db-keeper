import { StringDecoder } from "node:string_decoder";

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
    if (acc.length < MAX_ACC) acc += text;
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
