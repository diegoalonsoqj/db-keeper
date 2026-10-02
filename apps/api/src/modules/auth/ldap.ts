import { Client } from "ldapts";
import type { LdapMode, LdapSecurity } from "@dbkeeper/shared";
import { logger } from "../../config/logger.js";

/**
 * Autenticación contra Active Directory por LDAP. Dos modos:
 *
 * - `direct`: bind directo con DOMINIO\usuario (o usuario@dominio.com), sin cuenta de
 *   servicio. Si hay `searchBase`, con esa misma sesión lee nombre y correo.
 * - `search` (bind-search-bind): bind con una cuenta de servicio, busca al usuario por
 *   filtro para obtener su DN y re-bind con ese DN y la contraseña entregada.
 *
 * Cifrado: StartTLS (ldap://, se cifra antes de enviar credenciales), LDAPS (ldaps://)
 * o sin cifrar. Sin cifrar, el simple bind envía la contraseña en claro por la red.
 *
 * La configuración se resuelve en el módulo Settings (BD, con fallback a env) y se
 * inyecta aquí; esta función no lee variables de entorno.
 */
export interface LdapConfig {
  mode: LdapMode;
  url: string;
  security: LdapSecurity;
  /** Modo direct: NetBIOS (DINTERSEGURO) o DNS (empresa.com). */
  domain: string;
  /** Modo search: cuenta de servicio. */
  bindDn: string;
  bindPassword: string;
  /** Obligatoria en search; opcional en direct (solo para leer nombre/correo). */
  searchBase: string;
  userFilter: string; // usa {{username}} como placeholder
  tlsRejectUnauthorized: boolean;
}

export interface LdapUser {
  username: string;
  email: string | null;
  fullName: string | null;
}

/** Resultado detallado: distingue credenciales inválidas de fallos de conexión/config. */
export type LdapResult =
  | { ok: true; user: LdapUser }
  | { ok: false; reason: "invalid" | "error"; message: string };

const TIMEOUT_MS = 10_000;
const ATTRS = ["dn", "mail", "displayName", "sAMAccountName", "userPrincipalName"];

function escapeFilter(value: string): string {
  // RFC 4515: escapar caracteres especiales para evitar inyección de filtro LDAP.
  return value.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

function attr(value: string | string[] | Buffer | Buffer[] | undefined): string | null {
  if (value == null) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return null;
  return Buffer.isBuffer(v) ? v.toString("utf8") : String(v);
}

/** Abre una conexión y, con StartTLS, la cifra antes de cualquier bind. */
async function connect(config: LdapConfig): Promise<Client> {
  const tlsOptions = { rejectUnauthorized: config.tlsRejectUnauthorized };
  const client = new Client({ url: config.url, tlsOptions, timeout: TIMEOUT_MS, connectTimeout: TIMEOUT_MS });
  if (config.security === "starttls") await client.startTLS(tlsOptions);
  return client;
}

/** Nombre de bind del modo direct: usuario@dominio.com (DNS) o DOMINIO\usuario (NetBIOS). */
export function directBindName(domain: string, username: string): string {
  return domain.includes(".") ? `${username}@${domain}` : `${domain}\\${username}`;
}

/** AD: "invalidCredentials" (49) = usuario/contraseña incorrectos o cuenta bloqueada. */
function isInvalidCredentials(err: unknown): boolean {
  const e = err as { code?: number; name?: string };
  return e?.code === 49 || e?.name === "InvalidCredentialsError";
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readUser(client: Client, config: LdapConfig, username: string): Promise<LdapUser | null> {
  const filter = config.userFilter.replace("{{username}}", escapeFilter(username));
  const { searchEntries } = await client.search(config.searchBase, { scope: "sub", filter, attributes: ATTRS });
  const entry = searchEntries[0];
  if (!entry) return null;
  return {
    username: attr(entry["sAMAccountName"]) ?? username,
    email: attr(entry["mail"]) ?? attr(entry["userPrincipalName"]),
    fullName: attr(entry["displayName"]),
  };
}

async function authenticateDirect(username: string, password: string, config: LdapConfig): Promise<LdapResult> {
  let client: Client | null = null;
  try {
    client = await connect(config);
    try {
      await client.bind(directBindName(config.domain, username), password);
    } catch (err) {
      if (isInvalidCredentials(err)) return { ok: false, reason: "invalid", message: "Usuario o contraseña inválidos" };
      throw err;
    }
    // Datos del usuario (opcional): con su propia sesión; si falla, el login sigue siendo válido.
    let user: LdapUser = { username, email: null, fullName: null };
    if (config.searchBase) {
      try {
        user = (await readUser(client, config, username)) ?? user;
      } catch (err) {
        logger.warn({ err: describe(err) }, "LDAP: autenticado, pero no se pudieron leer nombre/correo");
      }
    }
    return { ok: true, user };
  } catch (err) {
    return { ok: false, reason: "error", message: describe(err) };
  } finally {
    await client?.unbind().catch(() => {});
  }
}

async function authenticateSearch(username: string, password: string, config: LdapConfig): Promise<LdapResult> {
  let svc: Client | null = null;
  try {
    svc = await connect(config);
    await svc.bind(config.bindDn, config.bindPassword);
    const filter = config.userFilter.replace("{{username}}", escapeFilter(username));
    const { searchEntries } = await svc.search(config.searchBase, { scope: "sub", filter, attributes: ATTRS });
    const entry = searchEntries[0];
    if (!entry) return { ok: false, reason: "invalid", message: "Usuario no encontrado en el directorio" };

    // Re-bind como el usuario para validar la contraseña.
    const userClient = await connect(config);
    try {
      await userClient.bind(entry.dn, password);
    } catch (err) {
      if (isInvalidCredentials(err)) return { ok: false, reason: "invalid", message: "Usuario o contraseña inválidos" };
      throw err;
    } finally {
      await userClient.unbind().catch(() => {});
    }
    return {
      ok: true,
      user: {
        username: attr(entry["sAMAccountName"]) ?? username,
        email: attr(entry["mail"]) ?? attr(entry["userPrincipalName"]),
        fullName: attr(entry["displayName"]),
      },
    };
  } catch (err) {
    return { ok: false, reason: "error", message: describe(err) };
  } finally {
    await svc?.unbind().catch(() => {});
  }
}

/** Autentica y devuelve el detalle (lo usa también "Probar AD" en Configuración). */
export async function tryAuthenticateLdap(username: string, password: string, config: LdapConfig): Promise<LdapResult> {
  // En AD un bind con contraseña vacía es un bind anónimo y "funciona": nunca aceptarlo.
  // El usuario no puede traer separadores de dominio (evita autenticarse como otro dominio).
  if (!password || !username.trim() || /[\\/@\0]/.test(username)) {
    return { ok: false, reason: "invalid", message: "Usuario o contraseña inválidos" };
  }
  const result =
    config.mode === "direct"
      ? await authenticateDirect(username, password, config)
      : await authenticateSearch(username, password, config);
  if (!result.ok && result.reason === "error") {
    logger.error({ err: result.message, mode: config.mode }, "LDAP: error durante la autenticación");
  }
  return result;
}

/** Para el login: usuario de AD si las credenciales son válidas; null si no. */
export async function authenticateLdap(username: string, password: string, config: LdapConfig): Promise<LdapUser | null> {
  const r = await tryAuthenticateLdap(username, password, config);
  return r.ok ? r.user : null;
}
