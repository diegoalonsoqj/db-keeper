/** Identificador de PostgreSQL (esquema, extensión): máx. 63 bytes. */
const MAX_IDENT_LEN = 63;
/** Tope de nombres excluidos por BD. */
const MAX_PER_DB = 200;

/**
 * Normaliza una opción por BD con forma `{ bd: [nombres] }` (p. ej.
 * `excludeSchemas`, `excludeExtensions`): conserva solo BDs del evento, nombres
 * recortados, válidos y sin duplicados (máx. 200 por BD); si no queda nada,
 * quita la clave. Devuelve una copia de `options`.
 */
export function normalizePerDbNames(
  options: Record<string, unknown>,
  key: string,
  databases: string[],
): Record<string, unknown> {
  const next = { ...options };
  const raw = options[key];
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const db of databases) {
      const list = (raw as Record<string, unknown>)[db];
      if (!Array.isArray(list)) continue;
      const names = [...new Set(list.map((s) => String(s).trim()))].filter(
        (s) => s.length > 0 && s.length <= MAX_IDENT_LEN && !s.includes("\0"),
      );
      if (names.length > 0) out[db] = names.slice(0, MAX_PER_DB);
    }
  }
  if (Object.keys(out).length > 0) next[key] = out;
  else delete next[key];
  return next;
}

/** Esquemas y extensiones excluidos por BD (`options.excludeSchemas` / `excludeExtensions`). */
export function normalizeExclusions(options: Record<string, unknown>, databases: string[]): Record<string, unknown> {
  return normalizePerDbNames(normalizePerDbNames(options, "excludeSchemas", databases), "excludeExtensions", databases);
}
