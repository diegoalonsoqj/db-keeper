import type {
  AppLocale,
  BackupMethod,
  DbEngine,
  ExecutionOrigin,
  ExecutionState,
} from "./index.js";

/** Proveedores de nube soportados (de momento solo `gcp` es funcional). */
export const CLOUD_PROVIDERS = ["gcp", "aws", "azure"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

/** Tipo de destino de almacenamiento: carpeta local o bucket en la nube. */
export const STORAGE_TYPES = ["local", "bucket"] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

/** Puerto por defecto sugerido por motor (para la UI). */
export const DEFAULT_PORTS: Record<DbEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  mongo: 27017,
};

/** Opciones de dump configurables por evento. */
export type BackupOptionKey =
  | "compress"
  | "excludeTables"
  /** PostgreSQL: esquemas que NO se respaldan, por BD (`options.excludeSchemas[db]`). */
  | "excludeSchemas"
  /** PostgreSQL: extensiones que NO se respaldan, por BD (`options.excludeExtensions[db]`). */
  | "excludeExtensions"
  /** PostgreSQL: event triggers que NO se respaldan, por BD (`options.excludeEventTriggers[db]`). */
  | "excludeEventTriggers"
  | "cleanDefiners"
  /** PostgreSQL: dump restaurable en versiones anteriores (import de Cloud SQL). */
  | "pgCompat"
  | "verbose"
  | "sqlBackupDir";

/**
 * Opciones de dump aplicables a cada motor (para que el modal muestre solo las
 * que tienen sentido). `excludeTables` no aplica a Mongo; SQL Server aún sin
 * opciones propias.
 */
export const ENGINE_BACKUP_OPTIONS: Record<DbEngine, BackupOptionKey[]> = {
  postgres: [
    "compress",
    "excludeTables",
    "excludeSchemas",
    "excludeExtensions",
    "excludeEventTriggers",
    "pgCompat",
    "verbose",
  ],
  mysql: ["compress", "excludeTables", "cleanDefiners", "verbose"],
  mongo: ["compress", "verbose"],
  sqlserver: ["sqlBackupDir", "compress"],
};

/** Instancia de base de datos. Nunca expone la contraseña. */
export interface ServerDto {
  id: string;
  name: string;
  engine: DbEngine;
  /** null solo en instancias Cloud SQL (el export no se conecta a la BD). */
  host: string | null;
  port: number;
  environment: string | null;
  useSsl: boolean;
  /** MongoDB: conexión SRV (`mongodb+srv://`, Atlas): sin puerto y con TLS. */
  mongoSrv: boolean;
  /** MongoDB: opciones de conexión admitidas (ver MONGO_CONN_OPTION_KEYS). */
  connOptions: Record<string, string>;
  isCloudSql: boolean;
  gcpProject: string | null;
  gcpInstance: string | null;
  /** Credencial de nube (GCP) para la API de Cloud SQL; null = la GCP por defecto o ADC. */
  cloudCredentialId: string | null;
  notes: string | null;
  /** Credencial del catálogo asignada a la instancia (reutilizable). */
  credentialId: string | null;
  credentialName: string | null;
  credentialUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ambiente del catálogo (`core.environments`). Alimenta el selector de la instancia. */
export interface EnvironmentDto {
  id: string;
  name: string;
  /** Código corto (PRD, UAT, DEV…) usado en el nombre del backup. */
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Credencial reutilizable del catálogo (`secrets.credentials`). Nunca expone la
 * contraseña. Permite definir un "usuario de backups" una vez y asignarlo a
 * varias instancias.
 */
export interface CredentialDto {
  id: string;
  name: string;
  username: string;
  /** Código del ambiente del catálogo (PRD/UAT/…) o null. */
  environment: string | null;
  description: string | null;
  hasExtra: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialInput {
  name: string;
  username: string;
  /** En altas es obligatoria; en ediciones, vacía = mantener la actual. */
  password?: string;
  /** Datos extra (p. ej. clave de servicio GCP); se cifra. */
  extra?: Record<string, unknown> | null;
  environment?: string | null;
  description?: string | null;
}

/**
 * Evento de backup (`core.backup_jobs`): definición reutilizable de qué respaldar
 * (instancia + credencial + BDs + método + destino). Cada corrida genera una
 * ejecución con su propio identificador.
 */
export interface BackupJobDto {
  id: string;
  name: string;
  serverId: string;
  serverName: string;
  /** Credencial override; null = usar la de la instancia. */
  credentialId: string | null;
  credentialName: string | null;
  method: BackupMethod;
  bucketId: string | null;
  bucketName: string | null;
  /** Ambiente (código) consolidado del evento; validado contra instancia y credencial. */
  environment: string | null;
  options: Record<string, unknown>;
  isActive: boolean;
  /** Nombres de las BDs seleccionadas. */
  databases: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BackupJobInput {
  name: string;
  serverId: string;
  credentialId?: string | null;
  method: BackupMethod;
  bucketId?: string | null;
  options?: Record<string, unknown>;
  isActive?: boolean;
  databases: string[];
}

/** Resultado de una BD dentro de una ejecución (`core.execution_items`). */
export interface ExecutionItemDto {
  id: string;
  dbName: string;
  status: ExecutionState;
  fileName: string | null;
  fileBytes: number | null;
  /** Salida de error del motor cuando la BD falló; null si fue bien. */
  log: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Fecha en que el archivo se borró por retención; null = sigue disponible. */
  prunedAt: string | null;
}

/**
 * Política de retención de un evento (en `options.retention`). Se conserva un
 * backup mientras no supere `days` de antigüedad **y** quede dentro de los
 * últimos `keepLast`; al violar cualquiera de las dos, su archivo se purga. Cada
 * regla es opcional (null = no aplica esa dimensión).
 */
export interface RetentionPolicy {
  days: number | null;
  keepLast: number | null;
}

/** Cabecera de una corrida de un evento de backup (`core.executions`). */
export interface ExecutionDto {
  id: string;
  jobId: string | null;
  label: string;
  /** Ambiente (código) del evento al momento de la corrida (snapshot). */
  environment: string | null;
  status: ExecutionState;
  origin: ExecutionOrigin;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  items: ExecutionItemDto[];
}

/**
 * Evento empujado por SSE al cambiar el estado de una ejecución. Lleva el
 * snapshot completo de la ejecución tras la transición (el cliente reemplaza el
 * registro por `id`). Ver `docs/REALTIME-QUEUE-DESIGN.md`.
 */
export type BackupStreamEvent =
  | { type: "execution-updated"; execution: ExecutionDto }
  | {
      /** Líneas de salida en vivo del motor (consola) para una BD de la ejecución. */
      type: "execution-log";
      executionId: string;
      dbName: string;
      lines: string[];
    }
  | {
      /** Tamaño actual del archivo de dump en curso (bytes), para progreso en vivo. */
      type: "execution-progress";
      executionId: string;
      dbName: string;
      bytes: number;
    };

/**
 * Destino de almacenamiento (`core.storage_targets`): carpeta local (con `path`)
 * o bucket en la nube (`provider`/`bucket`/`prefix` + clave de servicio cifrada).
 * Nunca expone la clave de servicio. `isDefault` marca el destino por tipo.
 */
/** Resumen para el Panel (`GET /api/dashboard`). */
export interface DashboardExecution {
  id: string;
  label: string;
  status: ExecutionState;
  environment: string | null;
  finishedAt: string | null;
  bytes: number;
}
export interface DashboardUpcoming {
  jobId: string;
  jobName: string;
  mode: "once" | "recurring";
  nextRunAt: string;
}
export interface DashboardDto {
  servers: number;
  jobsTotal: number;
  jobsActive: number;
  executions7d: { total: number; success: number; failed: number; bytes: number };
  recent: DashboardExecution[];
  upcoming: DashboardUpcoming[];
  db: "up";
}

/** Modo de programación de un evento de backup. */
export const SCHEDULE_MODES = ["once", "recurring"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

/** Programación de un evento de backup (`core.backup_schedules`). */
export interface ScheduleDto {
  id: string;
  jobId: string;
  mode: ScheduleMode;
  /** Modo `once`: instante a ejecutar (ISO). */
  runAt: string | null;
  /** Modo `recurring`: expresión cron. */
  cron: string | null;
  timezone: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  mode: ScheduleMode;
  /** ISO local (sin zona); se interpreta en `timezone`. */
  runAt?: string | null;
  cron?: string | null;
  timezone?: string;
  isActive?: boolean;
}

export interface StorageTargetDto {
  id: string;
  type: StorageType;
  name: string;
  /** Solo `local`: ruta del directorio destino. */
  path: string | null;
  /** Solo `bucket`: proveedor de nube. */
  provider: CloudProvider | null;
  bucket: string | null;
  prefix: string | null;
  isActive: boolean;
  isDefault: boolean;
  /** Credencial de nube del catálogo (solo `bucket`). */
  cloudCredentialId: string | null;
  cloudCredentialName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Credencial de nube del catálogo (`secrets.cloud_credentials`). El secreto (clave
 * JSON de GCP, claves de AWS, etc.) nunca se expone; `metadata` lleva datos no
 * secretos para identificarla (p. ej. GCP: `clientEmail`, `projectId`).
 */
/**
 * Tipo de credencial de nube: `key` = clave (JSON) cifrada en el catálogo;
 * `compute` = identidad de la VM de Compute Engine donde corre DBKeeper (sin clave).
 */
export const CLOUD_CREDENTIAL_KINDS = ["key", "compute"] as const;
export type CloudCredentialKind = (typeof CLOUD_CREDENTIAL_KINDS)[number];

export interface CloudCredentialDto {
  id: string;
  name: string;
  provider: CloudProvider;
  kind: CloudCredentialKind;
  metadata: Record<string, unknown>;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GeneralSettings {
  timezone: string;
  defaultLanguage: AppLocale;
}

/** Config de AD/LDAP. La contraseña de bind nunca se devuelve (solo `hasBindPassword`). */
/**
 * Modo de autenticación AD: `direct` = bind con DOMINIO\usuario (o usuario@dominio),
 * sin cuenta de servicio; `search` = cuenta de servicio que busca al usuario y re-bind.
 */
export const LDAP_MODES = ["direct", "search"] as const;
export type LdapMode = (typeof LDAP_MODES)[number];

/** Cifrado de la conexión: StartTLS (389), LDAPS (636) o sin cifrar (contraseña en claro). */
export const LDAP_SECURITY = ["starttls", "ldaps", "none"] as const;
export type LdapSecurity = (typeof LDAP_SECURITY)[number];

export interface LdapSettings {
  enabled: boolean;
  mode: LdapMode;
  /** Dominio del bind directo: NetBIOS (DINTERSEGURO) o DNS (empresa.com → usuario@empresa.com). */
  domain: string;
  security: LdapSecurity;
  url: string;
  bindDn: string;
  searchBase: string;
  userFilter: string;
  tlsRejectUnauthorized: boolean;
  hasBindPassword: boolean;
}

/** Resultado de "Probar AD" en Configuración. */
export interface LdapTestResultDto {
  ok: boolean;
  message: string;
  fullName: string | null;
  email: string | null;
}

/** Proveedor de envío de correo. */
export const EMAIL_PROVIDERS = ["smtp", "api"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/**
 * Configuración de notificaciones (global). Los secretos (contraseña SMTP, clave de
 * la API, bot token) nunca se exponen: solo banderas `has*`.
 */
export interface NotificationSettings {
  notifyOnStart: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  email: {
    enabled: boolean;
    provider: EmailProvider;
    from: string;
    recipients: string[];
    smtp: { host: string; port: number; secure: boolean; user: string; hasPassword: boolean };
    api: { url: string; authHeader: string; hasAuth: boolean };
  };
  telegram: { enabled: boolean; chatId: string; hasBotToken: boolean };
}

/** Límite de intentos de inicio de sesión fallidos (locales y AD). */
export interface SecuritySettings {
  loginLimitEnabled: boolean;
  /** Fallos permitidos por usuario dentro de la ventana antes de bloquearlo. */
  maxAttemptsPerUser: number;
  /** Fallos permitidos por IP (más alto: varias personas pueden salir por la misma IP). */
  maxAttemptsPerIp: number;
  windowMinutes: number;
  lockMinutes: number;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  loginLimitEnabled: true,
  maxAttemptsPerUser: 5,
  maxAttemptsPerIp: 20,
  windowMinutes: 15,
  lockMinutes: 15,
};

/** Ajustes de ejecución de backups. */
export interface BackupSettings {
  /** Cada cuántos minutos se registra "sigue en curso" en un export de Cloud SQL. 0 = desactivado. */
  cloudSqlHeartbeatMinutes: number;
  /** Dumps (procesos en este servidor) a la vez; el resto espera en cola. No cuenta los exports de Cloud SQL. */
  maxConcurrentDumps: number;
  /** Dump: se corta si no avanza (ni el archivo crece ni hay salida) durante estos minutos. */
  dumpInactivityMinutes: number;
  /** Dump: duración máxima por BD (red de seguridad), aunque siga avanzando. */
  dumpMaxHours: number;
  /** Export de Cloud SQL: horas de seguimiento activo; después se verifica en segundo plano. */
  cloudSqlExportTimeoutHours: number;
  /** Export de Cloud SQL: cada cuántos minutos se verifica en segundo plano. */
  cloudSqlVerifyIntervalMinutes: number;
  /** Export de Cloud SQL: tope absoluto; pasado esto se marca fallido. */
  cloudSqlExportMaxHours: number;
}

/** Límites de los ajustes de backups (formulario y API). */
export const BACKUP_SETTINGS_LIMITS = {
  cloudSqlHeartbeatMinutes: { min: 0, max: 1440 },
  maxConcurrentDumps: { min: 1, max: 10 },
  dumpInactivityMinutes: { min: 1, max: 1440 },
  dumpMaxHours: { min: 1, max: 168 },
  cloudSqlExportTimeoutHours: { min: 1, max: 48 },
  cloudSqlVerifyIntervalMinutes: { min: 1, max: 60 },
  cloudSqlExportMaxHours: { min: 1, max: 168 },
} as const satisfies Record<keyof BackupSettings, { min: number; max: number }>;

/** Valores por defecto (en la API, los de tiempo toman como base las variables del .env). */
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  cloudSqlHeartbeatMinutes: 5,
  maxConcurrentDumps: 1,
  dumpInactivityMinutes: 15,
  dumpMaxHours: 24,
  cloudSqlExportTimeoutHours: 6,
  cloudSqlVerifyIntervalMinutes: 5,
  cloudSqlExportMaxHours: 48,
};

export interface SettingsDto {
  general: GeneralSettings;
  ldap: LdapSettings;
  notifications: NotificationSettings;
  security: SecuritySettings;
  backups: BackupSettings;
}

/** Resultado de "Probar Cloud SQL": datos de la instancia leídos de la API de Cloud SQL Admin. */
export interface CloudSqlCheckDto {
  /** Estado de la instancia (`RUNNABLE`, `SUSPENDED`…). Solo `RUNNABLE` admite exports. */
  state: string;
  /** Versión del motor (p. ej. `SQLSERVER_2022_STANDARD`). */
  databaseVersion: string;
  region: string | null;
  /**
   * Service account propia de la instancia: es la que escribe el archivo en el bucket,
   * por lo que necesita `roles/storage.objectCreator` sobre él.
   */
  serviceAccountEmail: string | null;
}

/** Identidad de la VM (Compute Engine) detectada en el servidor de metadatos. */
export interface ComputeIdentityDto {
  /** true si DBKeeper corre en una VM de GCE con cuenta de servicio asignada. */
  available: boolean;
  email: string | null;
  projectId: string | null;
  /** Access scopes de la VM (limitan lo que la cuenta puede hacer, aunque IAM lo permita). */
  scopes: string[];
  /** Capacidades que los scopes de la VM NO cubren (vacío = todo OK). */
  missingScopes: string[];
  /** Id de la entrada del catálogo que ya la representa (null = aún no agregada). */
  credentialId: string | null;
}

/** BD encontrada al descubrir una instancia, con su tamaño si el motor lo informa. */
export interface DiscoveredDatabase {
  name: string;
  /** Tamaño en disco (bytes); null si no se pudo obtener (permisos o API de Cloud SQL). */
  bytes: number | null;
}

/** Extensión instalada en una BD de PostgreSQL (para excluirla del dump). */
export interface PgExtension {
  name: string;
  version: string;
}

/** Event trigger de una BD de PostgreSQL (para excluirlo del dump). */
export interface PgEventTrigger {
  name: string;
  /** Evento que lo dispara: ddl_command_start, ddl_command_end, sql_drop, table_rewrite… */
  event: string;
  /** `pg_event_trigger.evtenabled`: O (activo), D (deshabilitado), R (réplica), A (siempre). */
  enabled: string;
}

/** Formatea bytes a la unidad legible más cercana (B, KB, MB, …). */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
