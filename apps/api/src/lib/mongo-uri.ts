import { MONGO_SRV_DEFAULT_READ_PREFERENCE } from "@dbkeeper/shared";

export interface MongoUriInput {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  /** `mongodb+srv://` (Atlas): sin puerto y con TLS. */
  srv: boolean;
  /** Opciones de la instancia (ya validadas contra la lista cerrada). */
  options?: Record<string, string>;
  dbName?: string;
  /** Parámetros técnicos del llamador (p. ej. timeouts del descubrimiento). */
  extra?: Record<string, string>;
}

/**
 * URI de conexión para el driver y `mongodump`. Por defecto `authSource=admin`; en
 * SRV, TLS y lectura desde un secundario (para no cargar el primario en Atlas). Las
 * opciones de la instancia pisan los valores por defecto.
 */
export function buildMongoUri(c: MongoUriInput): string {
  const auth = `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}`;
  // Estándar: "host" → host:puerto; una lista "h1:27017,h2:27017" (replica set) va tal cual.
  const hosts = c.srv || /[,:]/.test(c.host) ? c.host : `${c.host}:${c.port}`;
  const params = new URLSearchParams({ authSource: "admin" });
  if (c.srv) {
    params.set("tls", "true");
    params.set("readPreference", MONGO_SRV_DEFAULT_READ_PREFERENCE);
  } else if (c.ssl) {
    params.set("tls", "true");
  }
  for (const [k, v] of Object.entries({ ...c.options, ...c.extra })) params.set(k, v);
  const db = c.dbName ? encodeURIComponent(c.dbName) : "";
  return `${c.srv ? "mongodb+srv" : "mongodb"}://${auth}@${hosts}/${db}?${params.toString()}`;
}
