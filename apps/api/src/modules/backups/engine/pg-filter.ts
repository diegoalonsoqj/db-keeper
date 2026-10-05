import { Transform } from "node:stream";

/** Bytes iniciales de cada línea suficientes para decidir si puede filtrarse. */
const HEAD_LEN = 32;

/**
 * Líneas que pg_dump ≥17 emite y que servidores/clientes anteriores rechazan:
 * - `SET transaction_timeout = 0;` (parámetro de PG17+; en ≤16 falla el import).
 * - `\restrict <clave>` / `\unrestrict <clave>` (meta-comandos de psql del parche
 *   CVE-2025-8714; un psql sin ese parche los rechaza).
 */
const COMPAT_PREFIXES = ["SET transaction_timeout", "\\restrict ", "\\unrestrict "];
const COMPAT_DROP_RE = /^(?:SET transaction_timeout = 0;|\\(?:un)?restrict [A-Za-z0-9]+)\r?\n?$/;

/** Sentencias de un event trigger que se quitan si está excluido (pueden ocupar varias líneas). */
const EVENT_TRIGGER_PREFIXES = ["CREATE EVENT TRIGGER ", "ALTER EVENT TRIGGER ", "COMMENT ON EVENT TRIGGER "];

const NL = 10;
const SEMI = 59; // ;
const SQUOTE = 39; // '
const DQUOTE = 34; // "

export interface PgDumpFilterOptions {
  /** Quitar las líneas incompatibles con PG ≤16 (ver COMPAT_DROP_RE). */
  compat?: boolean;
  /** Event triggers cuyas sentencias se quitan (nombres exactos). */
  excludeEventTriggers?: string[];
}

export type PgDumpFilter = Transform & {
  /** Event triggers excluidos que sí aparecían en el dump (y se quitaron). */
  readonly droppedEventTriggers: ReadonlySet<string>;
};

/**
 * Transform sobre un dump SQL plano de PostgreSQL (`pg_dump -Fp`) que quita las
 * líneas incompatibles con versiones anteriores y/o las sentencias de los event
 * triggers excluidos (pg_dump no tiene `--exclude-event-trigger`). Los datos de
 * los bloques `COPY … FROM stdin;` … `\.` pasan sin tocar, y ninguna línea se
 * acumula salvo las candidatas a filtrar o la sentencia `COPY`: una fila puede
 * pesar cientos de MB. Solo se reconocen sentencias que empiezan en columna 0,
 * como las escribe pg_dump.
 */
export function pgDumpFilter(opts: PgDumpFilterOptions): PgDumpFilter {
  const compat = opts.compat === true;
  const excluded = new Set(opts.excludeEventTriggers ?? []);
  const dropped = new Set<string>();

  let mode: "head" | "pass" | "line" | "stmt" = "head";
  let buf: Buffer[] = [];
  let bufLen = 0;
  let inCopy = false;
  // Estado de la sentencia de event trigger en curso (modo "stmt").
  let quote = 0; // comilla abierta (' o "), 0 si ninguna
  let stmtEnded = false; // se vio el `;` final fuera de comillas

  const take = (): Buffer => {
    const b = Buffer.concat(buf, bufLen);
    buf = [];
    bufLen = 0;
    return b;
  };
  /** Busca el `;` final fuera de literales e identificadores entre comillas. */
  const scan = (b: Buffer): void => {
    for (const c of b) {
      if (quote) {
        if (c === quote) quote = 0; // una comilla duplicada ('' o "") reabre en el siguiente byte
      } else if (c === SQUOTE || c === DQUOTE) quote = c;
      else if (c === SEMI) stmtEnded = true;
    }
  };
  /** Decide qué hacer con la línea en curso a partir de su inicio. */
  const classify = (head: Buffer, eol: boolean): typeof mode => {
    const s = head.toString("latin1");
    if (inCopy) {
      if (eol && /^\\\.\r?\n$/.test(s)) inCopy = false; // fin de datos del COPY
      return "pass";
    }
    if (s.startsWith("COPY ")) return "line";
    if (compat && COMPAT_PREFIXES.some((p) => s.startsWith(p))) return "line";
    if (excluded.size > 0 && EVENT_TRIGGER_PREFIXES.some((p) => s.startsWith(p))) {
      quote = 0;
      stmtEnded = false;
      return "stmt";
    }
    return "pass";
  };
  /** Línea completa en modo "line": se emite, o null si se descarta. */
  const finishLine = (line: Buffer): Buffer | null => {
    const s = line.toString("utf8");
    if (inCopy) return line;
    if (s.startsWith("COPY ")) {
      inCopy = /FROM stdin;\r?\n?$/.test(s);
      return line;
    }
    return compat && COMPAT_DROP_RE.test(s) ? null : line;
  };
  /** Sentencia completa de event trigger: se descarta si el trigger está excluido. */
  const finishStmt = (stmt: Buffer): Buffer | null => {
    const s = stmt.toString("utf8");
    const prefix = EVENT_TRIGGER_PREFIXES.find((p) => s.startsWith(p))!;
    const name = parseIdentifier(s.slice(prefix.length));
    if (name === null || !excluded.has(name)) return stmt;
    dropped.add(name);
    return null;
  };

  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const out: Buffer[] = [];
      let pos = 0;
      while (pos < chunk.length) {
        const nl = chunk.indexOf(NL, pos);
        const end = nl < 0 ? chunk.length : nl + 1;
        const seg = chunk.subarray(pos, end);
        const eol = nl >= 0;
        pos = end;
        if (mode === "pass") {
          out.push(seg);
          if (eol) mode = "head";
          continue;
        }
        buf.push(seg);
        bufLen += seg.length;
        if (mode === "stmt") scan(seg);
        if (mode === "head") {
          if (!eol && bufLen < HEAD_LEN) continue; // aún no se puede decidir
          const head = Buffer.concat(buf, bufLen);
          mode = classify(head, eol);
          if (mode === "pass") {
            out.push(take());
            if (eol) mode = "head";
            continue;
          }
          if (mode === "stmt") scan(head);
        }
        if (!eol) continue;
        if (mode === "line") {
          const line = finishLine(take());
          if (line) out.push(line);
          mode = "head";
        } else if (stmtEnded) {
          const stmt = finishStmt(take());
          if (stmt) out.push(stmt);
          mode = "head";
        }
      }
      cb(null, out.length ? Buffer.concat(out) : undefined);
    },
    flush(cb) {
      if (!bufLen) return cb();
      const rest = take();
      const last = mode === "stmt" ? (stmtEnded ? finishStmt(rest) : rest) : finishLine(rest);
      cb(null, last ?? undefined);
    },
  });
  return Object.assign(t, { droppedEventTriggers: dropped as ReadonlySet<string> });
}

/**
 * Identificador al inicio de `s`: entre comillas dobles (con `""` como comilla
 * literal) o sin comillas hasta el primer espacio, `;` o `(`. null si no hay.
 */
export function parseIdentifier(s: string): string | null {
  const str = s.trimStart();
  if (str.startsWith('"')) {
    let out = "";
    for (let i = 1; i < str.length; i++) {
      if (str[i] !== '"') out += str[i];
      else if (str[i + 1] === '"') {
        out += '"';
        i++;
      } else return out;
    }
    return null; // comilla sin cerrar
  }
  const m = /^[^\s;(]+/.exec(str);
  return m ? m[0] : null;
}
