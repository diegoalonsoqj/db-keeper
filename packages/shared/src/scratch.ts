/**
 * Dump paralelo de PostgreSQL (`pg_parallel`) con disco temporal de GCE: contratos
 * compartidos entre la API y la web (ajustes, opciones del evento y validaciones).
 */

/** Tipos de disco persistente admitidos para el disco temporal. */
export const SCRATCH_DISK_TYPES = ["pd-ssd", "pd-balanced", "hyperdisk-balanced"] as const;
export type ScratchDiskType = (typeof SCRATCH_DISK_TYPES)[number];

/** Configuración → Disco temporal: dónde y cómo se crea el disco de cada ejecución. */
export interface ScratchDiskSettings {
  /** Si es false, el método `pg_parallel` no se ofrece ni se ejecuta. */
  enabled: boolean;
  /** Punto de montaje del disco (una sola ejecución con disco a la vez). */
  mountPoint: string;
  /** Credencial GCP (catálogo) para la API de Compute; null = la GCP por defecto o la de la VM (ADC). */
  cloudCredentialId: string | null;
  diskType: ScratchDiskType;
  /** Tamaño cuando no hay historial ni override en el evento. */
  defaultSizeGb: number;
  /** Tope del autodimensionado y del override del evento (control de costo). */
  maxSizeGb: number;
  /** Margen sobre el último backup exitoso al autodimensionar (%). */
  sizeMarginPct: number;
  /** Cada cuánto se buscan discos temporales huérfanos para liberarlos. */
  gcIntervalMinutes: number;
  /** Archivos del dump que se suben al bucket a la vez. */
  uploadConcurrency: number;
}

export const SCRATCH_SETTINGS_LIMITS = {
  defaultSizeGb: { min: 10, max: 65_536 },
  maxSizeGb: { min: 10, max: 65_536 },
  sizeMarginPct: { min: 0, max: 200 },
  gcIntervalMinutes: { min: 5, max: 1440 },
  uploadConcurrency: { min: 1, max: 32 },
} as const;

export const DEFAULT_SCRATCH_SETTINGS: ScratchDiskSettings = {
  enabled: false,
  mountPoint: "/backup-alloydb",
  cloudCredentialId: null,
  diskType: "pd-ssd",
  defaultSizeGb: 1200,
  maxSizeGb: 2000,
  sizeMarginPct: 25,
  gcIntervalMinutes: 30,
  uploadConcurrency: 8,
};

/** Rutas del sistema donde nunca se monta el disco temporal. */
const FORBIDDEN_MOUNTS = ["/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var"];

/**
 * Valida el punto de montaje: ruta absoluta simple, sin `..` ni rutas del sistema.
 * Devuelve el motivo del rechazo o null si es válido. (El helper root la vuelve a
 * validar contra su propia lista de rutas permitidas.)
 */
export function mountPointError(p: string): string | null {
  if (!/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p)) {
    return "Debe ser una ruta absoluta (letras, números, punto, guion y guion bajo)";
  }
  if (p.split("/").some((seg) => seg === "." || seg === "..")) return "No puede contener . ni ..";
  if (FORBIDDEN_MOUNTS.some((f) => p === f || (f !== "/" && p.startsWith(`${f}/`)))) {
    return "No puede ser una ruta del sistema";
  }
  return null;
}

/** Opciones del evento con método `pg_parallel` (en `backup_jobs.options`). */
export interface ParallelDumpOptions {
  /** Workers de pg_dump (`-j`); abre `-j + 1` conexiones al origen. */
  parallelJobs: number;
  /** true = `--no-privileges` (sin GRANT/REVOKE). Por defecto se conservan. */
  noPrivileges: boolean;
  /** Tamaño del disco (GB); null = automático (historial + margen). */
  diskSizeGb: number | null;
  /** Tipo de disco; null = el de Configuración. */
  diskType: ScratchDiskType | null;
  /** Duración máxima del dump por BD (h), acotada por el tope global de Backups. */
  maxHours: number;
  /** Líneas de stderr que no se muestran ni guardan (texto literal, sin regex). */
  stderrIgnore: string[];
}

export const PARALLEL_DUMP_LIMITS = {
  parallelJobs: { min: 1, max: 32 },
  maxHours: { min: 1, max: 168 },
  stderrIgnoreLines: 20,
  stderrIgnoreLength: 200,
} as const;

export const DEFAULT_PARALLEL_MAX_HOURS = 12;

/** Ruido de `pg_dump --verbose` contra AlloyDB (el script original lo filtraba). */
export const ALLOYDB_STDERR_IGNORE = ["TopTransactionContext IS NOT NULL"];

/** Workers sugeridos: deja 2 vCPU para la API y el SO; máximo 14 (como el script). */
export function suggestParallelJobs(vcpus: number): number {
  return Math.max(1, Math.min(14, Math.floor(vcpus) - 2));
}

/**
 * Un backup "directorio" (formato -Fd subido como carpeta) se registra con la URI
 * del prefijo terminada en `/`: `gs://bucket/ruta/<bd>_<ts>/`.
 */
export function isDirectoryArtifact(fileName: string | null | undefined): boolean {
  return Boolean(fileName && fileName.endsWith("/"));
}

/** Nombre del manifiesto que acompaña a cada backup en formato directorio. */
export const PGDIR_MANIFEST = "manifest.json";

/** Entorno de ejecución del dump paralelo (para los formularios). */
export interface ParallelEnvironmentDto {
  /** Configuración → Disco temporal → Habilitado. */
  enabled: boolean;
  /** vCPU de la máquina donde corre DBKeeper. */
  vcpus: number;
  suggestedJobs: number;
  /** Datos de la VM de GCE (null si no corre en GCE). */
  gce: { project: string; zone: string; instance: string; machineType: string | null } | null;
  mountPoint: string;
  diskType: ScratchDiskType;
  defaultSizeGb: number;
  maxSizeGb: number;
  /** Tope global de duración de dumps (Configuración → Backups). */
  dumpMaxHours: number;
}

/** Resultado de "Probar configuración" del disco temporal (no crea nada). */
export interface ScratchCheckDto {
  ok: boolean;
  checks: { label: string; ok: boolean; detail: string | null }[];
}
