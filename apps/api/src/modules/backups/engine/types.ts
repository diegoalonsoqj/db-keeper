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
  /** Ruta absoluta del archivo de salida (sin extensión; el dumper la añade). */
  destPathNoExt: string;
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
