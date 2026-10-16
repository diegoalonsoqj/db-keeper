import { COLLECTION_RULE_LIMITS, collectionRuleError } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";

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

/** Opciones `{ bd: [nombres] }` de exclusión del dump de PostgreSQL. */
const EXCLUSION_KEYS = ["excludeSchemas", "excludeExtensions", "excludeEventTriggers"] as const;

/**
 * MongoDB: reglas de colecciones excluidas (`excludeCollections`, lista de patrones
 * con `*`). Recorta y quita duplicadas; rechaza (400) las inválidas en vez de
 * descartarlas en silencio: una regla ignorada respaldaría lo que se quería excluir,
 * y una que lo excluye todo dejaría el dump vacío.
 */
export function normalizeCollectionRules(options: Record<string, unknown>, databases: string[]): Record<string, unknown> {
  const next = { ...options };
  const raw = options.excludeCollections;
  const rules = Array.isArray(raw) ? dedupeRules(raw.map((r) => String(r).trim())) : [];
  if (rules.length > COLLECTION_RULE_LIMITS.maxRules) {
    throw HttpError.badRequest(`Máximo ${COLLECTION_RULE_LIMITS.maxRules} reglas de colecciones excluidas`);
  }
  for (const rule of rules) {
    const error = collectionRuleError(rule, databases);
    if (error) throw HttpError.badRequest(`Colecciones excluidas: ${error}`);
  }
  if (rules.length > 0) next.excludeCollections = rules;
  else delete next.excludeCollections;
  return next;
}

/** Sin vacías ni duplicadas (sin distinguir mayúsculas, igual que al aplicarlas). */
function dedupeRules(rules: string[]): string[] {
  const seen = new Set<string>();
  return rules.filter((r) => r !== "" && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase()));
}

/** Esquemas, extensiones y event triggers excluidos por BD, y reglas de colecciones (Mongo). */
export function normalizeExclusions(options: Record<string, unknown>, databases: string[]): Record<string, unknown> {
  const perDb = EXCLUSION_KEYS.reduce((opts, key) => normalizePerDbNames(opts, key, databases), options);
  return normalizeCollectionRules(perDb, databases);
}
