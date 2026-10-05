import { Transform } from "node:stream";

/** Bytes iniciales de cada línea suficientes para decidir si puede filtrarse. */
const HEAD_LEN = 32;

/** Inicios de línea que se acumulan completos para inspeccionarlos. */
const COLLECT_PREFIXES = ["COPY ", "SET transaction_timeout", "\\restrict ", "\\unrestrict "];

/**
 * Líneas que pg_dump ≥17 emite y que servidores/clientes anteriores rechazan:
 * - `SET transaction_timeout = 0;` (parámetro de PG17+; en ≤16 falla el import).
 * - `\restrict <clave>` / `\unrestrict <clave>` (meta-comandos de psql del parche
 *   CVE-2025-8714; un psql sin ese parche los rechaza).
 */
const DROP_RE = /^(?:SET transaction_timeout = 0;|\\(?:un)?restrict [A-Za-z0-9]+)\r?\n?$/;

/**
 * Transform que quita de un dump SQL plano de PostgreSQL las líneas listadas en
 * `DROP_RE`, para restaurarlo en versiones anteriores (p. ej. import de Cloud SQL
 * en PG ≤16). Los datos de los bloques `COPY … FROM stdin;` pasan sin tocar, y
 * ninguna línea se acumula salvo las candidatas a filtrar o la sentencia `COPY`:
 * una fila puede pesar cientos de MB.
 */
export function pgCompatFilter(): Transform {
  let mode: "head" | "pass" | "collect" = "head";
  let buf: Buffer[] = [];
  let bufLen = 0;
  let inCopy = false;

  const take = (): Buffer => {
    const b = Buffer.concat(buf, bufLen);
    buf = [];
    bufLen = 0;
    return b;
  };
  /** Línea completa en modo head/collect: se emite, o null si se descarta. */
  const finish = (line: Buffer): Buffer | null => {
    const s = line.toString("utf8");
    if (inCopy) {
      if (/^\\\.\r?\n?$/.test(s)) inCopy = false; // fin de datos del COPY
      return line;
    }
    if (s.startsWith("COPY ")) {
      inCopy = /FROM stdin;\r?\n?$/.test(s);
      return line;
    }
    return DROP_RE.test(s) ? null : line;
  };
  const decide = (head: Buffer): "pass" | "collect" => {
    if (inCopy) return "pass";
    const s = head.toString("latin1");
    return COLLECT_PREFIXES.some((p) => s.startsWith(p)) ? "collect" : "pass";
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const out: Buffer[] = [];
      let pos = 0;
      while (pos < chunk.length) {
        const nl = chunk.indexOf(10, pos);
        const end = nl < 0 ? chunk.length : nl + 1;
        if (mode === "pass") {
          out.push(chunk.subarray(pos, end));
          if (nl >= 0) mode = "head";
          pos = end;
          continue;
        }
        buf.push(chunk.subarray(pos, end));
        bufLen += end - pos;
        pos = end;
        if (nl >= 0) {
          const line = finish(take());
          if (line) out.push(line);
          mode = "head";
        } else if (mode === "head" && bufLen >= HEAD_LEN) {
          mode = decide(Buffer.concat(buf, bufLen));
          if (mode === "pass") out.push(take());
        }
      }
      cb(null, out.length ? Buffer.concat(out) : undefined);
    },
    flush(cb) {
      const line = bufLen ? finish(take()) : null;
      cb(null, line ?? undefined);
    },
  });
}
