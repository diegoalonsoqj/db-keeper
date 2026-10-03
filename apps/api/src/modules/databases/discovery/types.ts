import type { DiscoveredDatabase } from "@dbkeeper/shared";

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

/** Lista las bases de datos de la instancia (sin las del sistema), con su tamaño si se puede. */
export type Discoverer = (conn: ConnInfo) => Promise<DiscoveredDatabase[]>;

/** Timeout de conexión/consulta para el descubrimiento (ms). */
export const DISCOVER_TIMEOUT_MS = 8000;
