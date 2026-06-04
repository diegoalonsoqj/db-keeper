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
  credentialUsername: string | null;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialInput {
  username: string;
  /** En altas es obligatoria; en ediciones, vacía = mantener la actual. */
  password?: string;
  /** Datos extra (p. ej. clave de servicio GCP); se cifra. */
  extra?: Record<string, unknown> | null;
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
