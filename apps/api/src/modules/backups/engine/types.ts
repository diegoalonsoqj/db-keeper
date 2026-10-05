import type { DumpLimits } from "./supervise.js";

/** Datos de conexión + destino para volcar una base de datos. */
export interface DumpInput {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  dbName: string;
  /** Comprimir con gzip (`.sql.gz`); si es false, SQL plano (`.sql`). */
  compress: boolean;
  /** Tablas a excluir del dump (patrones de `--exclude-table` / `--ignore-table`). */
  excludeTables: string[];
  /** PostgreSQL: esquemas que NO se respaldan (nombres exactos, `--exclude-schema`). */
  excludeSchemas?: string[];
  /** PostgreSQL: extensiones que NO se respaldan (nombres exactos, `--exclude-extension`, pg_dump ≥ 17). */
  excludeExtensions?: string[];
  /** PostgreSQL: event triggers que NO se respaldan (se filtran de la salida de pg_dump). */
  excludeEventTriggers?: string[];
  /** MySQL: quitar cláusulas `DEFINER` (compat. Cloud SQL). */
  cleanDefiners?: boolean;
  /** PostgreSQL: quitar líneas que versiones anteriores rechazan (ver pg-compat.ts). */
  pgCompat?: boolean;
  /** MongoDB: conexión SRV (Atlas) en vez de `mongodb://host:port`. */
  mongoSrv?: boolean;
  /** MongoDB: opciones de conexión de la instancia. */
  connOptions?: Record<string, string>;
  /** Modo detallado: añade `--verbose` al motor (más salida por stderr). */
  verbose?: boolean;
  /** Recibe cada línea de salida del motor (stderr) para la consola en vivo. */
  onLog?: (line: string) => void;
  /** Ruta absoluta del archivo de salida (sin extensión; el dumper la añade). */
  destPathNoExt: string;
  /** Corte por inactividad y tope total del proceso de dump. */
  limits: DumpLimits;
}

/** Resultado de un volcado correcto. */
export interface DumpResult {
  /** Ruta absoluta del archivo generado. */
  filePath: string;
  /** Tamaño del archivo en bytes. */
  bytes: number;
}

/** Vuelca una BD a un archivo local. Lanza si falla (mensaje sin secretos). */
export type Dumper = (input: DumpInput) => Promise<DumpResult>;
