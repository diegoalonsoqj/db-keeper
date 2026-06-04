import type { GeneralSettings, LdapSettings, SettingsDto } from "@dbkeeper/shared";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import type { LdapConfig } from "../auth/ldap.js";
import * as repo from "./settings.repository.js";

const GENERAL_KEY = "general";
const LDAP_KEY = "ldap";

const DEFAULT_GENERAL: GeneralSettings = { timezone: "America/Lima", defaultLanguage: "es-419" };

/** Forma cruda almacenada en core.app_settings['ldap'] (con la contraseña cifrada). */
interface StoredLdap {
  enabled: boolean;
  url: string;
  bindDn: string;
  bindPasswordEncrypted: string | null;
  searchBase: string;
  userFilter: string;
  tlsRejectUnauthorized: boolean;
}

const EMPTY_LDAP: StoredLdap = {
  enabled: false,
  url: "",
  bindDn: "",
  bindPasswordEncrypted: null,
  searchBase: "",
  userFilter: "(sAMAccountName={{username}})",
  tlsRejectUnauthorized: true,
};

async function getStoredLdap(): Promise<StoredLdap | null> {
  return repo.getSetting<StoredLdap>(LDAP_KEY);
}

export async function getGeneral(): Promise<GeneralSettings> {
  return (await repo.getSetting<GeneralSettings>(GENERAL_KEY)) ?? DEFAULT_GENERAL;
}

export async function getSettings(): Promise<SettingsDto> {
  const general = await getGeneral();
  const stored = (await getStoredLdap()) ?? EMPTY_LDAP;
  const ldap: LdapSettings = {
    enabled: stored.enabled,
    url: stored.url,
    bindDn: stored.bindDn,
    searchBase: stored.searchBase,
    userFilter: stored.userFilter,
    tlsRejectUnauthorized: stored.tlsRejectUnauthorized,
    hasBindPassword: Boolean(stored.bindPasswordEncrypted),
  };
  return { general, ldap };
}

export async function updateGeneral(patch: Partial<GeneralSettings>): Promise<GeneralSettings> {
  const current = await getGeneral();
  const next = { ...current, ...patch };
  await repo.upsertSetting(GENERAL_KEY, next);
  return next;
}

export interface UpdateLdapInput {
  enabled?: boolean;
  url?: string;
  bindDn?: string;
  searchBase?: string;
  userFilter?: string;
  tlsRejectUnauthorized?: boolean;
  /** Si viene definida, se cifra y reemplaza la actual. Cadena vacía = borrar. */
  bindPassword?: string;
}

export async function updateLdap(input: UpdateLdapInput): Promise<LdapSettings> {
  const current = (await getStoredLdap()) ?? EMPTY_LDAP;

  let bindPasswordEncrypted = current.bindPasswordEncrypted;
  if (input.bindPassword !== undefined) {
    bindPasswordEncrypted = input.bindPassword === "" ? null : encryptSecret(input.bindPassword);
  }

  const next: StoredLdap = {
    enabled: input.enabled ?? current.enabled,
    url: input.url ?? current.url,
    bindDn: input.bindDn ?? current.bindDn,
    searchBase: input.searchBase ?? current.searchBase,
    userFilter: input.userFilter ?? current.userFilter,
    tlsRejectUnauthorized: input.tlsRejectUnauthorized ?? current.tlsRejectUnauthorized,
    bindPasswordEncrypted,
  };
  await repo.upsertSetting(LDAP_KEY, next);

  return {
    enabled: next.enabled,
    url: next.url,
    bindDn: next.bindDn,
    searchBase: next.searchBase,
    userFilter: next.userFilter,
    tlsRejectUnauthorized: next.tlsRejectUnauthorized,
    hasBindPassword: Boolean(next.bindPasswordEncrypted),
  };
}

/**
 * Config efectiva de LDAP para autenticar (con la contraseña descifrada).
 * Preferencia: BD (si está habilitada y completa) → variables de entorno (compat).
 * Devuelve null si no hay configuración utilizable.
 */
export async function getLdapRuntimeConfig(): Promise<LdapConfig | null> {
  const stored = await getStoredLdap();
  if (stored?.enabled && stored.url && stored.bindDn && stored.bindPasswordEncrypted && stored.searchBase) {
    return {
      url: stored.url,
      bindDn: stored.bindDn,
      bindPassword: decryptSecret(stored.bindPasswordEncrypted),
      searchBase: stored.searchBase,
      userFilter: stored.userFilter,
      tlsRejectUnauthorized: stored.tlsRejectUnauthorized,
    };
  }

  // Fallback a env (configuración temporal previa a Settings).
  if (env.LDAP_URL && env.LDAP_BIND_DN && env.LDAP_BIND_PASSWORD && env.LDAP_SEARCH_BASE) {
    return {
      url: env.LDAP_URL,
      bindDn: env.LDAP_BIND_DN,
      bindPassword: env.LDAP_BIND_PASSWORD,
      searchBase: env.LDAP_SEARCH_BASE,
      userFilter: env.LDAP_USER_FILTER,
      tlsRejectUnauthorized: env.LDAP_TLS_REJECT_UNAUTHORIZED,
    };
  }

  return null;
}
