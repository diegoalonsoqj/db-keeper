import type { AppLocale, DbEngine } from "./index.js";

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

/**
 * Credencial reutilizable del catálogo (`secrets.credentials`). Nunca expone la
 * contraseña. Permite definir un "usuario de backups" una vez y asignarlo a
 * varias instancias.
 */
export interface CredentialDto {
  id: string;
  name: string;
  username: string;
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
  description?: string | null;
}

/** Base de datos seleccionada para respaldar (`core.databases`). */
export interface DatabaseDto {
  id: string;
  serverId: string;
  name: string;
  /** Esquemas a incluir (Postgres); null hasta una iteración posterior. */
  schemas: string[] | null;
  createdAt: string;
  updatedAt: string;
}

/** Base detectada al descubrir una instancia en vivo. */
export interface DiscoveredDatabaseDto {
  name: string;
  /** Ya está marcada para respaldo (presente en `core.databases`). */
  selected: boolean;
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
