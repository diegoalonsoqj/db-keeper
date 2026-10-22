/**
 * Búsqueda, filtros y orden de los listados (contrato API ↔ web). Cada listado
 * declara sus claves de orden; la API las traduce a expresiones SQL fijas.
 */

export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

export const EXECUTION_SORTS = ["created", "finished", "label", "status", "environment", "databases", "duration", "size"] as const;
export type ExecutionSort = (typeof EXECUTION_SORTS)[number];

export const JOB_SORTS = ["name", "server", "environment", "method", "destination", "active"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export const SERVER_SORTS = ["name", "engine", "host", "port", "environment", "credential"] as const;
export type ServerSort = (typeof SERVER_SORTS)[number];

export const CREDENTIAL_SORTS = ["name", "username", "environment", "description"] as const;
export type CredentialSort = (typeof CREDENTIAL_SORTS)[number];

export const USER_SORTS = ["username", "fullName", "authType", "status"] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const AUDIT_SORTS = ["created", "username", "action", "entity", "ip"] as const;
export type AuditSort = (typeof AUDIT_SORTS)[number];

/** Plataforma de una instancia (filtro de Instancias). */
export const SERVER_PLATFORMS = ["standard", "cloudsql", "alloydb"] as const;
export type ServerPlatform = (typeof SERVER_PLATFORMS)[number];

/**
 * Código de ejecución escrito en el buscador (`#3F2504E0`, `3f25…`): devuelve el
 * prefijo hexadecimal en minúsculas o null si el texto no lo parece.
 */
export function parseExecutionCode(q: string): string | null {
  const m = /^#?([0-9a-f]{4,8})$/i.exec(q.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export const ARTIFACT_SORTS = ["finished", "label", "database", "environment", "size"] as const;
export type ArtifactSort = (typeof ARTIFACT_SORTS)[number];
