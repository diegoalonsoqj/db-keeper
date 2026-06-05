import { z } from "zod";

/**
 * Configuración 12-factor. El `.env` se mantiene mínimo (ver spec §13):
 * solo lo imprescindible para arrancar y descifrar el resto desde la BD.
 * Falla rápido y ruidoso si falta o es inválido algo.
 */
const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  APP_SECRET_KEY: z.string().min(16, "APP_SECRET_KEY debe tener al menos 16 caracteres"),

  // Clave maestra (32 bytes en base64) para cifrar/descifrar secretos en BD (AES-256-GCM).
  DBKEEPER_MASTER_KEY: z.string().min(1, "DBKEEPER_MASTER_KEY es requerida"),

  // Única conexión que no puede vivir en la BD: la de la propia BD de metadatos.
  DATABASE_URL: z.string().url("DATABASE_URL debe ser una URL de conexión válida"),

  // Broker de tareas / tiempo real (se usará desde la Etapa 4).
  REDIS_URL: z.string().url().optional(),

  // --- Motor de backups (Etapa 4, fase 2) ---
  // Carpeta destino de los dumps locales. Se resuelve contra el cwd del proceso
  // (que en dev/start es apps/api); por defecto apunta a /backups en la raíz del
  // repo, ya ignorada por git.
  BACKUP_DIR: z.string().default("../../backups"),
  // Ruta al binario pg_dump (si no está en el PATH).
  PG_DUMP_PATH: z.string().default("pg_dump"),
  // Timeout por base de datos para el volcado (ms). Por defecto 30 min.
  BACKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // --- AD / LDAP (temporal en env; migra al módulo Settings en la Etapa 2) ---
  LDAP_URL: z.string().optional(), // ldap(s)://host:389
  LDAP_BIND_DN: z.string().optional(), // cuenta de servicio para buscar usuarios
  LDAP_BIND_PASSWORD: z.string().optional(),
  LDAP_SEARCH_BASE: z.string().optional(), // OU=Users,DC=empresa,DC=com
  LDAP_USER_FILTER: z.string().default("(sAMAccountName={{username}})"),
  LDAP_TLS_REJECT_UNAUTHORIZED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // --- Bootstrap del superadmin inicial (solo lo usa el seed) ---
  BOOTSTRAP_ADMIN_USERNAME: z.string().default("admin"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // No usamos el logger aquí porque la config aún no es válida.
  console.error(`\n[config] Variables de entorno inválidas:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
export const isProd = env.APP_ENV === "production";
