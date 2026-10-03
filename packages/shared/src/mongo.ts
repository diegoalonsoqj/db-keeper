/**
 * Conexión a MongoDB: opciones admitidas y parser de la cadena de conexión (la
 * que entrega Atlas). Compartido para que el formulario y la API validen igual.
 */

/** Opciones de conexión admitidas (lista cerrada: no se cuelan parámetros arbitrarios en la URI). */
export const MONGO_CONN_OPTION_KEYS = [
  "authSource",
  "replicaSet",
  "readPreference",
  "appName",
  "retryWrites",
  "w",
  "tls",
  "directConnection",
] as const;
export type MongoConnOptionKey = (typeof MONGO_CONN_OPTION_KEYS)[number];

export const MONGO_READ_PREFERENCES = [
  "primary",
  "primaryPreferred",
  "secondary",
  "secondaryPreferred",
  "nearest",
] as const;

/** Lectura por defecto en Atlas (SRV): un secundario, para no cargar el primario. */
export const MONGO_SRV_DEFAULT_READ_PREFERENCE = "secondaryPreferred";

const BOOL_KEYS = new Set<string>(["retryWrites", "tls", "directConnection"]);
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Valida una opción; devuelve el motivo si no es válida o null si está bien. */
export function validateMongoOption(key: string, value: string): string | null {
  if (!(MONGO_CONN_OPTION_KEYS as readonly string[]).includes(key)) return `opción no admitida: ${key}`;
  if (BOOL_KEYS.has(key)) return value === "true" || value === "false" ? null : `${key} debe ser true o false`;
  if (key === "readPreference") {
    return (MONGO_READ_PREFERENCES as readonly string[]).includes(value) ? null : `readPreference inválido: ${value}`;
  }
  if (key === "w") return value === "majority" || /^\d{1,2}$/.test(value) ? null : `w inválido: ${value}`;
  return NAME_RE.test(value) ? null : `${key} inválido: ${value}`;
}

/** Opciones como texto de query ("a=1&b=2") ↔ objeto. */
export function mongoOptionsToText(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export function mongoOptionsFromText(text: string): { options: Record<string, string>; errors: string[] } {
  const options: Record<string, string> = {};
  const errors: string[] = [];
  for (const part of text.split("&").map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    const key = eq >= 0 ? part.slice(0, eq).trim() : part;
    const value = eq >= 0 ? decodeURIComponent(part.slice(eq + 1).trim()) : "";
    const err = validateMongoOption(key, value);
    if (err) errors.push(err);
    else options[key] = value;
  }
  return { options, errors };
}

export interface ParsedMongoConnection {
  /** `mongodb+srv://` (Atlas). */
  srv: boolean;
  /** Host (SRV: el del cluster) o lista `h1:27017,h2:27017` (estándar). */
  host: string;
  /** Puerto si la cadena trae un único host con puerto; null si no aplica. */
  port: number | null;
  /** Usuario de la cadena (para sugerir la credencial); la contraseña se descarta. */
  username: string | null;
  hadPassword: boolean;
  options: Record<string, string>;
  /** Opciones de la cadena no admitidas (se ignoran). */
  rejected: string[];
}

/**
 * Desarma una cadena `mongodb://` o `mongodb+srv://`. La contraseña NO se devuelve:
 * va en Credenciales (cifrada), nunca en la instancia.
 */
export function parseMongoConnectionString(raw: string): ParsedMongoConnection {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(?:\/[^?]*)?(?:\?(.*))?$/i.exec(raw.trim());
  if (!m) throw new Error("Cadena inválida: debe empezar con mongodb:// o mongodb+srv://");
  const [, scheme, userInfo, hostPart, query] = m;
  const srv = scheme!.toLowerCase() === "mongodb+srv";

  let username: string | null = null;
  let hadPassword = false;
  if (userInfo) {
    const colon = userInfo.indexOf(":");
    const user = decodeURIComponent(colon >= 0 ? userInfo.slice(0, colon) : userInfo);
    hadPassword = colon >= 0;
    // Atlas entrega marcadores como <db_username>: no son un usuario real.
    username = user && !/^<.*>$/.test(user) ? user : null;
  }

  let host = hostPart!;
  let port: number | null = null;
  if (!srv && !host.includes(",")) {
    const hp = /^(.+):(\d{1,5})$/.exec(host);
    if (hp) {
      host = hp[1]!;
      port = Number(hp[2]);
    }
  }

  const options: Record<string, string> = {};
  const rejected: string[] = [];
  for (const part of (query ?? "").split("&").filter(Boolean)) {
    const eq = part.indexOf("=");
    const key = eq >= 0 ? part.slice(0, eq) : part;
    const value = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : "";
    if (validateMongoOption(key, value)) rejected.push(key);
    else options[key] = value;
  }
  return { srv, host, port, username, hadPassword, options, rejected };
}
