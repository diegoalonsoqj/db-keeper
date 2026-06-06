import type {
  EmailProvider,
  GeneralSettings,
  LdapSettings,
  NotificationSettings,
  SettingsDto,
} from "@dbkeeper/shared";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import type { LdapConfig } from "../auth/ldap.js";
import * as repo from "./settings.repository.js";

const GENERAL_KEY = "general";
const LDAP_KEY = "ldap";
const NOTIF_KEY = "notifications";

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
  return { general, ldap, notifications: notifToDto(await getStoredNotif()) };
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
