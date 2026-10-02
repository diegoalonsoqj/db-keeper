import { DEFAULT_BACKUP_SETTINGS, DEFAULT_SECURITY_SETTINGS } from "@dbkeeper/shared";
import type {
  BackupSettings,
  EmailProvider,
  GeneralSettings,
  LdapMode,
  LdapSecurity,
  LdapSettings,
  LdapTestResultDto,
  SecuritySettings,
  NotificationSettings,
  SettingsDto,
} from "@dbkeeper/shared";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { tryAuthenticateLdap, type LdapConfig } from "../auth/ldap.js";
import * as repo from "./settings.repository.js";

const GENERAL_KEY = "general";
const LDAP_KEY = "ldap";
const NOTIF_KEY = "notifications";
const SECURITY_KEY = "security";
const BACKUPS_KEY = "backups";

const DEFAULT_GENERAL: GeneralSettings = { timezone: "America/Lima", defaultLanguage: "es-419" };

/** Forma cruda almacenada en core.app_settings['ldap'] (con la contraseña cifrada). */
interface StoredLdap {
  enabled: boolean;
  /** Ausentes en configuraciones previas: se derivan en `withLdapDefaults`. */
  mode?: LdapMode;
  domain?: string;
  security?: LdapSecurity;
  url: string;
  bindDn: string;
  bindPasswordEncrypted: string | null;
  searchBase: string;
  userFilter: string;
  tlsRejectUnauthorized: boolean;
}

const EMPTY_LDAP: StoredLdap = {
  enabled: false,
  mode: "direct",
  domain: "",
  security: "starttls",
  url: "",
  bindDn: "",
  bindPasswordEncrypted: null,
  searchBase: "",
  userFilter: "(sAMAccountName={{username}})",
  tlsRejectUnauthorized: true,
};

/** Seguridad implícita en la URL (configs previas a este campo): ldaps:// → LDAPS. */
function securityFromUrl(url: string): LdapSecurity {
  return /^ldaps:\/\//i.test(url) ? "ldaps" : "none";
}

/**
 * Completa los campos nuevos de una config guardada antes de existir: una config previa
 * usaba cuenta de servicio (`search`) y el cifrado lo daba la URL. Así no cambia su
 * comportamiento al actualizar.
 */
function withLdapDefaults(s: StoredLdap): Required<StoredLdap> {
  return {
    ...s,
    mode: s.mode ?? "search",
    domain: s.domain ?? "",
    security: s.security ?? securityFromUrl(s.url),
  };
}

async function getStoredLdap(): Promise<Required<StoredLdap> | null> {
  const s = await repo.getSetting<StoredLdap>(LDAP_KEY);
  return s ? withLdapDefaults(s) : null;
}

/** DTO público (sin la contraseña de bind, solo si existe). */
function ldapToDto(s: Required<StoredLdap>): LdapSettings {
  return {
    enabled: s.enabled,
    mode: s.mode,
    domain: s.domain,
    security: s.security,
    url: s.url,
    bindDn: s.bindDn,
    searchBase: s.searchBase,
    userFilter: s.userFilter,
    tlsRejectUnauthorized: s.tlsRejectUnauthorized,
    hasBindPassword: Boolean(s.bindPasswordEncrypted),
  };
}

/**
 * Forma cruda almacenada en core.app_settings['notifications'] (con los secretos cifrados:
 * contraseña SMTP, auth de la API y bot token de Telegram).
 */
interface StoredNotif {
  notifyOnStart: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  email: {
    enabled: boolean;
    provider: EmailProvider;
    from: string;
    recipients: string[];
    smtp: { host: string; port: number; secure: boolean; user: string; passwordEncrypted: string | null };
    api: { url: string; authHeader: string; authEncrypted: string | null };
  };
  telegram: { enabled: boolean; chatId: string; botTokenEncrypted: string | null };
}

const EMPTY_NOTIF: StoredNotif = {
  notifyOnStart: false,
  notifyOnSuccess: false,
  notifyOnFailure: true,
  email: {
    enabled: false,
    provider: "smtp",
    from: "",
    recipients: [],
    smtp: { host: "", port: 587, secure: false, user: "", passwordEncrypted: null },
    api: { url: "", authHeader: "Authorization", authEncrypted: null },
  },
  telegram: { enabled: false, chatId: "", botTokenEncrypted: null },
};

async function getStoredNotif(): Promise<StoredNotif> {
  return (await repo.getSetting<StoredNotif>(NOTIF_KEY)) ?? EMPTY_NOTIF;
}

/** Proyecta la forma cruda al DTO público (oculta secretos tras banderas `has*`). */
function notifToDto(stored: StoredNotif): NotificationSettings {
  return {
    notifyOnStart: stored.notifyOnStart,
    notifyOnSuccess: stored.notifyOnSuccess,
    notifyOnFailure: stored.notifyOnFailure,
    email: {
      enabled: stored.email.enabled,
      provider: stored.email.provider,
      from: stored.email.from,
      recipients: stored.email.recipients,
      smtp: {
        host: stored.email.smtp.host,
        port: stored.email.smtp.port,
        secure: stored.email.smtp.secure,
        user: stored.email.smtp.user,
        hasPassword: Boolean(stored.email.smtp.passwordEncrypted),
      },
      api: {
        url: stored.email.api.url,
        authHeader: stored.email.api.authHeader,
        hasAuth: Boolean(stored.email.api.authEncrypted),
      },
    },
    telegram: {
      enabled: stored.telegram.enabled,
      chatId: stored.telegram.chatId,
      hasBotToken: Boolean(stored.telegram.botTokenEncrypted),
    },
  };
}

/** Límite de intentos de login (con los valores por defecto para claves faltantes). */
export async function getSecurity(): Promise<SecuritySettings> {
  const stored = await repo.getSetting<Partial<SecuritySettings>>(SECURITY_KEY);
  return { ...DEFAULT_SECURITY_SETTINGS, ...(stored ?? {}) };
}

export async function updateSecurity(patch: Partial<SecuritySettings>): Promise<SecuritySettings> {
  const next = { ...(await getSecurity()), ...patch };
  await repo.upsertSetting(SECURITY_KEY, next);
  return next;
}

/** Ajustes de ejecución de backups (con los valores por defecto para claves faltantes). */
export async function getBackupSettings(): Promise<BackupSettings> {
  const stored = await repo.getSetting<Partial<BackupSettings>>(BACKUPS_KEY);
  return { ...DEFAULT_BACKUP_SETTINGS, ...(stored ?? {}) };
}

export async function updateBackupSettings(patch: Partial<BackupSettings>): Promise<BackupSettings> {
  const next = { ...(await getBackupSettings()), ...patch };
  await repo.upsertSetting(BACKUPS_KEY, next);
  return next;
}

export async function getGeneral(): Promise<GeneralSettings> {
  return (await repo.getSetting<GeneralSettings>(GENERAL_KEY)) ?? DEFAULT_GENERAL;
}

export async function getSettings(): Promise<SettingsDto> {
  const general = await getGeneral();
  const ldap = ldapToDto((await getStoredLdap()) ?? withLdapDefaults(EMPTY_LDAP));
  return { general, ldap, notifications: notifToDto(await getStoredNotif()), security: await getSecurity(), backups: await getBackupSettings() };
}

export async function updateGeneral(patch: Partial<GeneralSettings>): Promise<GeneralSettings> {
  const current = await getGeneral();
  const next = { ...current, ...patch };
  await repo.upsertSetting(GENERAL_KEY, next);
  return next;
}

export interface UpdateLdapInput {
  enabled?: boolean;
  mode?: LdapMode;
  domain?: string;
  security?: LdapSecurity;
  url?: string;
  bindDn?: string;
  searchBase?: string;
  userFilter?: string;
  tlsRejectUnauthorized?: boolean;
  /** Si viene definida, se cifra y reemplaza la actual. Cadena vacía = borrar. */
  bindPassword?: string;
}

/** NetBIOS (DINTERSEGURO) o DNS (empresa.com). Sin barras ni espacios. */
const DOMAIN_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;

/** Coherencia URL ↔ cifrado y campos obligatorios del modo (solo si está habilitado). */
function validateLdap(s: Required<StoredLdap>): void {
  const url = s.url.trim();
  if (url) {
    if (!/^ldaps?:\/\//i.test(url)) throw HttpError.badRequest("La URL debe empezar con ldap:// o ldaps://");
    const isLdaps = /^ldaps:\/\//i.test(url);
    if (s.security === "ldaps" && !isLdaps) throw HttpError.badRequest("Con LDAPS la URL debe empezar con ldaps:// (puerto 636)");
    if (s.security !== "ldaps" && isLdaps) throw HttpError.badRequest("Con StartTLS o sin cifrar la URL debe empezar con ldap:// (puerto 389)");
  }
  if (s.domain && !DOMAIN_RE.test(s.domain)) throw HttpError.badRequest("Dominio inválido (p. ej. DINTERSEGURO o empresa.com)");
  if (!s.enabled) return;
  if (!url) throw HttpError.badRequest("Indica la URL del servidor AD");
  if (s.mode === "direct" && !s.domain) throw HttpError.badRequest("Indica el dominio para el bind directo");
  if (s.mode === "search" && (!s.bindDn || !s.bindPasswordEncrypted || !s.searchBase)) {
    throw HttpError.badRequest("Con cuenta de servicio indica Bind DN, su contraseña y la base de búsqueda");
  }
}

export async function updateLdap(input: UpdateLdapInput): Promise<LdapSettings> {
  const current = (await getStoredLdap()) ?? withLdapDefaults(EMPTY_LDAP);

  let bindPasswordEncrypted = current.bindPasswordEncrypted;
  if (input.bindPassword !== undefined) {
    bindPasswordEncrypted = input.bindPassword === "" ? null : encryptSecret(input.bindPassword);
  }

  const next: Required<StoredLdap> = {
    enabled: input.enabled ?? current.enabled,
    mode: input.mode ?? current.mode,
    domain: (input.domain ?? current.domain).trim(),
    security: input.security ?? current.security,
    url: (input.url ?? current.url).trim(),
    bindDn: input.bindDn ?? current.bindDn,
    searchBase: input.searchBase ?? current.searchBase,
    userFilter: input.userFilter ?? current.userFilter,
    tlsRejectUnauthorized: input.tlsRejectUnauthorized ?? current.tlsRejectUnauthorized,
    bindPasswordEncrypted,
  };
  validateLdap(next);
  await repo.upsertSetting(LDAP_KEY, next);
  return ldapToDto(next);
}

export interface UpdateNotifInput {
  notifyOnStart?: boolean;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  email?: {
    enabled?: boolean;
    provider?: EmailProvider;
    from?: string;
    recipients?: string[];
    smtp?: { host?: string; port?: number; secure?: boolean; user?: string; password?: string };
    api?: { url?: string; authHeader?: string; auth?: string };
  };
  telegram?: { enabled?: boolean; chatId?: string; botToken?: string };
}

/** Si el secreto viene definido se cifra y reemplaza; cadena vacía = borrar; ausente = no tocar. */
function nextSecret(current: string | null, input: string | undefined): string | null {
  if (input === undefined) return current;
  return input === "" ? null : encryptSecret(input);
}

export async function updateNotifications(input: UpdateNotifInput): Promise<NotificationSettings> {
  const current = await getStoredNotif();

  const next: StoredNotif = {
    notifyOnStart: input.notifyOnStart ?? current.notifyOnStart,
    notifyOnSuccess: input.notifyOnSuccess ?? current.notifyOnSuccess,
    notifyOnFailure: input.notifyOnFailure ?? current.notifyOnFailure,
    email: {
      enabled: input.email?.enabled ?? current.email.enabled,
      provider: input.email?.provider ?? current.email.provider,
      from: input.email?.from ?? current.email.from,
      recipients: input.email?.recipients ?? current.email.recipients,
      smtp: {
        host: input.email?.smtp?.host ?? current.email.smtp.host,
        port: input.email?.smtp?.port ?? current.email.smtp.port,
        secure: input.email?.smtp?.secure ?? current.email.smtp.secure,
        user: input.email?.smtp?.user ?? current.email.smtp.user,
        passwordEncrypted: nextSecret(current.email.smtp.passwordEncrypted, input.email?.smtp?.password),
      },
      api: {
        url: input.email?.api?.url ?? current.email.api.url,
        authHeader: input.email?.api?.authHeader ?? current.email.api.authHeader,
        authEncrypted: nextSecret(current.email.api.authEncrypted, input.email?.api?.auth),
      },
    },
    telegram: {
      enabled: input.telegram?.enabled ?? current.telegram.enabled,
      chatId: input.telegram?.chatId ?? current.telegram.chatId,
      botTokenEncrypted: nextSecret(current.telegram.botTokenEncrypted, input.telegram?.botToken),
    },
  };
  await repo.upsertSetting(NOTIF_KEY, next);
  return notifToDto(next);
}

/** Config efectiva de notificaciones con los secretos descifrados (para el envío real). */
export interface NotifRuntimeConfig {
  notifyOnStart: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  email: {
    enabled: boolean;
    provider: EmailProvider;
    from: string;
    recipients: string[];
    smtp: { host: string; port: number; secure: boolean; user: string; password: string | null };
    api: { url: string; authHeader: string; auth: string | null };
  };
  telegram: { enabled: boolean; chatId: string; botToken: string | null };
}

/**
 * Devuelve la config de notificaciones con los secretos en claro. Úsala solo en el
 * momento del envío; nunca la persistas ni la loguees.
 */
export async function getNotifRuntimeConfig(): Promise<NotifRuntimeConfig> {
  const s = await getStoredNotif();
  return {
    notifyOnStart: s.notifyOnStart,
    notifyOnSuccess: s.notifyOnSuccess,
    notifyOnFailure: s.notifyOnFailure,
    email: {
      enabled: s.email.enabled,
      provider: s.email.provider,
      from: s.email.from,
      recipients: s.email.recipients,
      smtp: {
        host: s.email.smtp.host,
        port: s.email.smtp.port,
        secure: s.email.smtp.secure,
        user: s.email.smtp.user,
        password: s.email.smtp.passwordEncrypted ? decryptSecret(s.email.smtp.passwordEncrypted) : null,
      },
      api: {
        url: s.email.api.url,
        authHeader: s.email.api.authHeader,
        auth: s.email.api.authEncrypted ? decryptSecret(s.email.api.authEncrypted) : null,
      },
    },
    telegram: {
      enabled: s.telegram.enabled,
      chatId: s.telegram.chatId,
      botToken: s.telegram.botTokenEncrypted ? decryptSecret(s.telegram.botTokenEncrypted) : null,
    },
  };
}

/**
 * Config efectiva de LDAP para autenticar (con la contraseña descifrada).
 * Preferencia: BD (si está habilitada y completa) → variables de entorno (compat).
 * Devuelve null si no hay configuración utilizable.
 */
export async function getLdapRuntimeConfig(): Promise<LdapConfig | null> {
  const stored = await getStoredLdap();
  if (stored?.enabled && stored.url) {
    const base = {
      mode: stored.mode,
      url: stored.url,
      security: stored.security,
      domain: stored.domain,
      searchBase: stored.searchBase,
      userFilter: stored.userFilter,
      tlsRejectUnauthorized: stored.tlsRejectUnauthorized,
    };
    if (stored.mode === "direct" && stored.domain) return { ...base, bindDn: "", bindPassword: "" };
    if (stored.mode === "search" && stored.bindDn && stored.bindPasswordEncrypted && stored.searchBase) {
      return { ...base, bindDn: stored.bindDn, bindPassword: decryptSecret(stored.bindPasswordEncrypted) };
    }
  }

  // Fallback a env (configuración temporal previa a Settings).
  if (env.LDAP_URL && env.LDAP_BIND_DN && env.LDAP_BIND_PASSWORD && env.LDAP_SEARCH_BASE) {
    return {
      mode: "search",
      url: env.LDAP_URL,
      security: securityFromUrl(env.LDAP_URL),
      domain: "",
      bindDn: env.LDAP_BIND_DN,
      bindPassword: env.LDAP_BIND_PASSWORD,
      searchBase: env.LDAP_SEARCH_BASE,
      userFilter: env.LDAP_USER_FILTER,
      tlsRejectUnauthorized: env.LDAP_TLS_REJECT_UNAUTHORIZED,
    };
  }

  return null;
}

/**
 * "Probar AD": valida usuario y contraseña con la configuración **guardada**. Distingue
 * credenciales inválidas de errores de conexión/TLS para facilitar el diagnóstico.
 */
export async function testLdap(username: string, password: string): Promise<LdapTestResultDto> {
  const config = await getLdapRuntimeConfig();
  if (!config) {
    return { ok: false, message: "AD no está habilitado o le faltan datos: guarda la configuración primero", fullName: null, email: null };
  }
  const r = await tryAuthenticateLdap(username, password, config);
  if (r.ok) {
    return { ok: true, message: "Autenticación correcta", fullName: r.user.fullName, email: r.user.email };
  }
  const message = r.reason === "invalid" ? r.message : `No se pudo conectar o autenticar con AD: ${r.message}`;
  return { ok: false, message, fullName: null, email: null };
}
