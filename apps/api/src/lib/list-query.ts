import { z } from "zod";
import { SORT_DIRS, type SortDir } from "@dbkeeper/shared";
import { paginationSchema } from "./pagination.js";

/**
 * Query string común de los listados con búsqueda y orden: paginación + `q` + `sort`
 * y `dir`. `sort` se valida contra las claves permitidas de cada listado (nunca se
 * interpola texto del cliente en el SQL: la clave se traduce a una expresión fija).
 */
export function listQuerySchema<K extends string>(sortKeys: readonly [K, ...K[]]) {
  return paginationSchema.extend({
    q: z.string().trim().max(100).optional().transform((v) => v || undefined),
    sort: z.enum(sortKeys).optional(),
    dir: z.enum(SORT_DIRS).optional(),
  });
}

/** Booleano de query string ("true"/"false"); vacío = sin filtro. */
export const boolParam = z
  .enum(["true", "false", ""])
  .optional()
  .transform((v) => (v === "true" ? true : v === "false" ? false : undefined));

/** Texto de filtro exacto opcional; vacío = sin filtro. */
export const textParam = z.string().trim().max(100).optional().transform((v) => v || undefined);

/** Escapa los comodines de LIKE (`%`, `_`) y el escape (`\`, el de PostgreSQL por defecto). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Constructor de WHERE parametrizado. Cada valor va como `$n`; las columnas y
 * expresiones las fija el código, nunca el cliente.
 */
export class SqlWhere {
  readonly params: unknown[] = [];
  private readonly parts: string[] = [];

  /** Agrega un parámetro y devuelve su placeholder. */
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  add(condition: string): this {
    this.parts.push(condition);
    return this;
  }

  /** `col = $n` si hay valor. */
  eq(column: string, value: unknown): this {
    if (value !== undefined && value !== null && value !== "") this.add(`${column} = ${this.param(value)}`);
    return this;
  }

  /** Coincidencia parcial sin distinguir mayúsculas en cualquiera de las columnas. */
  search(columns: string[], q: string | undefined, extra: string[] = []): this {
    if (!q) return this;
    const p = this.param(`%${escapeLike(q)}%`);
    this.add(`(${[...columns.map((c) => `${c} ILIKE ${p}`), ...extra].join(" OR ")})`);
    return this;
  }

  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(" AND ")}` : "";
  }
}

/**
 * ORDER BY a partir de una clave permitida. `nullsLast` deja los vacíos al final en
 * ambos sentidos; `tieBreaker` hace el orden estable entre páginas.
 */
export function orderBy<K extends string>(
  columns: Record<K, string>,
  sort: K | undefined,
  dir: SortDir | undefined,
  fallback: { sort: K; dir: SortDir },
  tieBreaker: string,
): string {
  const key = sort ?? fallback.sort;
  const d = dir ?? (sort ? "asc" : fallback.dir);
  return `ORDER BY ${columns[key]} ${d === "desc" ? "DESC" : "ASC"} NULLS LAST, ${tieBreaker}`;
}
