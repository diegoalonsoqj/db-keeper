/**
 * Reglas de exclusión de colecciones de MongoDB (`options.excludeCollections`).
 * Compartido para que la vista previa del modal y el motor de backup excluyan
 * exactamente lo mismo.
 *
 * Cada regla es un patrón con `*` (cualquier secuencia, incluida vacía), sin
 * distinguir mayúsculas: `*_old`, `tmp_*`, `audit_log`. Si empieza por
 * `<bd>.` y esa BD está en el evento, solo aplica a esa BD
 * (`notification-db.cache_*`); si no, aplica a todas. En MongoDB los nombres de BD
 * no admiten `.`, así que el prefijo no es ambiguo.
 */

export const COLLECTION_RULE_LIMITS = { maxRules: 200, maxLength: 255 } as const;

/**
 * Motivo por el que una regla no es válida, o null si lo es. `databases`: BDs del
 * evento (una regla `<bd>.*` también excluiría la BD entera).
 */
export function collectionRuleError(rule: string, databases: readonly string[]): string | null {
  if (!rule) return "regla vacía";
  if (rule.length > COLLECTION_RULE_LIMITS.maxLength) return `regla de más de ${COLLECTION_RULE_LIMITS.maxLength} caracteres`;
  if (rule.includes("\0")) return "regla con caracteres no válidos";
  // Solo comodines: el dump de la BD quedaría vacío (para eso, quítala del evento).
  const scoped = databases.length
    ? databases.map((db) => patternFor(rule, db, databases)).filter((p): p is string => p !== null)
    : [rule];
  if (scoped.some((p) => /^\*+$/.test(p))) return `la regla «${rule}» excluiría todas las colecciones`;
  return null;
}

/** Separa el texto del formulario (comas o saltos de línea) en reglas, sin vacías ni duplicadas. */
export function parseCollectionRules(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const r = raw.trim();
    if (r && !seen.has(r.toLowerCase())) {
      seen.add(r.toLowerCase());
      out.push(r);
    }
  }
  return out;
}

/** Patrón (sin el prefijo de BD) que aplica a `db`, o null si la regla es de otra BD. */
function patternFor(rule: string, db: string, databases: readonly string[]): string | null {
  const dot = rule.indexOf(".");
  if (dot > 0) {
    const scope = rule.slice(0, dot);
    if (databases.includes(scope)) return scope === db ? rule.slice(dot + 1) : null;
  }
  return rule;
}

/**
 * Coincidencia de comodines `*` sin regex (sin riesgo de ReDoS): algoritmo
 * voraz con retroceso al último `*`, O(n·m) en el peor caso.
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  const p = pattern.toLowerCase();
  const s = text.toLowerCase();
  let pi = 0;
  let si = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (pi < p.length && p[pi] !== "*" && p[pi] === s[si]) {
      pi++;
      si++;
    } else if (pi < p.length && p[pi] === "*") {
      star = pi++;
      mark = si;
    } else if (star >= 0) {
      pi = star + 1;
      si = ++mark;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

/**
 * Primera regla que excluye la colección `coll` de la BD `db`, o null si se respalda.
 * `databases`: BDs del evento (para distinguir el prefijo `<bd>.`).
 */
export function matchCollectionRule(
  rules: readonly string[],
  db: string,
  coll: string,
  databases: readonly string[],
): string | null {
  for (const rule of rules) {
    const pattern = patternFor(rule, db, databases);
    if (pattern !== null && wildcardMatch(pattern, coll)) return rule;
  }
  return null;
}

/** Colección de una BD de MongoDB (para elegir cuáles excluir del dump). */
export interface MongoCollectionInfo {
  name: string;
  /** "collection", "view" o "timeseries". */
  type: string;
}
