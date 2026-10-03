/** Datos de conexión para descubrir las BDs de una instancia. */
export interface ConnInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  /** MongoDB: conexión SRV (Atlas). */
  mongoSrv?: boolean;
  /** MongoDB: opciones de conexión de la instancia. */
  connOptions?: Record<string, string>;
}

/** Lista los nombres de bases de datos de la instancia (sin las del sistema). */
export type Discoverer = (conn: ConnInfo) => Promise<string[]>;

/** Timeout de conexión/consulta para el descubrimiento (ms). */
export const DISCOVER_TIMEOUT_MS = 8000;
