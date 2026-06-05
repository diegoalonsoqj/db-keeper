import type {
  AppLocale,
  BackupMethod,
  DbEngine,
  ExecutionOrigin,
  ExecutionState,
} from "./index.js";

/** Proveedores de almacenamiento soportados. */
export const STORAGE_PROVIDERS = ["gcs"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/** Puerto por defecto sugerido por motor (para la UI). */
export const DEFAULT_PORTS: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  mongo: 27017,
};

/** Opciones de dump configurables por evento. */
export type BackupOptionKey = "compress" | "excludeTables";

/**
 * Opciones de dump aplicables a cada motor (para que el modal muestre solo las
 * que tienen sentido). `excludeTables` no aplica a Mongo; SQL Server aún sin
 * opciones propias.
 */
export const ENGINE_BACKUP_OPTIONS: Record<DbEngine, BackupOptionKey[]> = {
  postgres: ["compress", "excludeTables"],
  mysql: ["compress", "excludeTables"],
  mongo: ["compress"],
  sqlserver: [],
};

/** Instancia de base de datos. Nunca expone la contraseña. */
export interface ServerDto {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  environment: string | null;
  useSsl: boolean;
  isCloudSql: boolean;
  gcpProject: string | null;
  gcpInstance: string | null;
  notes: string | null;
  /** Credencial del catálogo asignada a la instancia (reutilizable). */
  credentialId: string | null;
  credentialName: string | null;
  credentialUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ambiente del catálogo (`core.environments`). Alimenta el selector de la instancia. */
export interface EnvironmentDto {
  id: string;
  name: string;
  /** Código corto (PRD, UAT, DEV…) usado en el nombre del backup. */
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Credencial reutilizable del catálogo (`secrets.credentials`). Nunca expone la
 * contraseña. Permite definir un "usuario de backups" una vez y asignarlo a
 * varias instancias.
 */
export interface CredentialDto {
  id: string;
  name: string;
  username: string;
  /** Código del ambiente del catálogo (PRD/UAT/…) o null. */
  environment: string | null;
  description: string | null;
  hasExtra: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialInput {
  name: string;
  username: string;
  /** En altas es obligatoria; en ediciones, vacía = mantener la actual. */
  password?: string;
  /** Datos extra (p. ej. clave de servicio GCP); se cifra. */
  extra?: Record<string, unknown> | null;
  environment?: string | null;
  description?: string | null;
}

/**
 * Evento de backup (`core.backup_jobs`): definición reutilizable de qué respaldar
 * (instancia + credencial + BDs + método + destino). Cada corrida genera una
 * ejecución con su propio identificador.
 */
export interface BackupJobDto {
  id: string;
  name: string;
  serverId: string;
  serverName: string;
  /** Credencial override; null = usar la de la instancia. */
  credentialId: string | null;
  credentialName: string | null;
  method: BackupMethod;
  bucketId: string | null;
  bucketName: string | null;
  options: Record<string, unknown>;
  isActive: boolean;
  /** Nombres de las BDs seleccionadas. */
  databases: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BackupJobInput {
  name: string;
  serverId: string;
  credentialId?: string | null;
  method: BackupMethod;
  bucketId?: string | null;
  options?: Record<string, unknown>;
  isActive?: boolean;
  databases: string[];
}

/** Resultado de una BD dentro de una ejecución (`core.execution_items`). */
export interface ExecutionItemDto {
  id: string;
  dbName: string;
  status: ExecutionState;
  fileName: string | null;
  fileBytes: number | null;
  /** Salida de error del motor cuando la BD falló; null si fue bien. */
  log: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Cabecera de una corrida de un evento de backup (`core.executions`). */
export interface ExecutionDto {
  id: string;
  jobId: string | null;
  label: string;
  status: ExecutionState;
  origin: ExecutionOrigin;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  items: ExecutionItemDto[];
}

/** Destino de almacenamiento. Nunca expone la clave de servicio. */
export interface BucketDto {
  id: string;
  name: string;
  provider: StorageProvider;
  bucket: string;
  prefix: string | null;
  isActive: boolean;
  hasServiceAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GeneralSettings {
  timezone: string;
  defaultLanguage: AppLocale;
}

/** Config de AD/LDAP. La contraseña de bind nunca se devuelve (solo `hasBindPassword`). */
export interface LdapSettings {
  enabled: boolean;
  url: string;
  bindDn: string;
  searchBase: string;
  userFilter: string;
  tlsRejectUnauthorized: boolean;
  hasBindPassword: boolean;
}

export interface SettingsDto {
  general: GeneralSettings;
  ldap: LdapSettings;
}
