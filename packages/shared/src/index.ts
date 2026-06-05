/**
 * Contratos compartidos entre API y Web.
 * En la Etapa 0 solo definimos los enums/contratos base; cada módulo
 * (auth, servers, backups…) irá añadiendo sus tipos en su propia etapa.
 */

export const APP_LOCALES = ["es-419", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "es-419";

/** Roles base del sistema. Sus permisos por defecto son editables (Etapa 1). */
export const ROLES = ["superadmin", "admin", "editor", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Origen de autenticación de un usuario. */
export const AUTH_TYPES = ["local", "ad"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/** Motores de base de datos soportados. */
export const DB_ENGINES = ["sqlserver", "mysql", "postgres", "mongo"] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

/** Método de generación de backup. */
export const BACKUP_METHODS = ["dump", "gcloud"] as const;
export type BackupMethod = (typeof BACKUP_METHODS)[number];

/** Estado de un evento de backup o de cada ítem (por BD). */
export const EXECUTION_STATES = ["pending", "running", "success", "failed"] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

/** Sobre de respuesta uniforme de la API. */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

/** Resultado paginado uniforme para listados. */
export interface Paginated<T> {
  items: T[];
  total: number;
}

/** Tamaños de página ofrecidos en las tablas; el primero es el de por defecto. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE: number = PAGE_SIZES[0];

export * from "./auth.js";
export * from "./resources.js";
