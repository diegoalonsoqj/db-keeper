import { GoogleAuth } from "google-auth-library";

/**
 * Cliente mínimo de la API REST de Cloud SQL Admin (v1). Se usa la API en vez del
 * CLI `gcloud`: no requiere instalar el SDK en el servidor, no lanza procesos de
 * shell y los errores llegan estructurados.
 *
 * Permisos de la service account que llama: `cloudsql.instances.get`,
 * `cloudsql.instances.export` y `cloudsql.databases.list` (rol personalizado; no
 * hace falta `roles/cloudsql.admin`).
 */
const BASE = "https://sqladmin.googleapis.com/v1";

/** BDs de sistema de SQL Server: nunca se ofrecen para exportar. */
const SQLSERVER_SYSTEM_DBS = new Set(["master", "model", "msdb", "tempdb"]);

/** Reintentos ante 409 (la instancia ya tiene otra operación en curso). */
const BUSY_RETRIES = 10;
const BUSY_WAIT_MS = 30_000;
/** Consulta de la operación: espera creciente entre estos límites. */
const POLL_MIN_MS = 5_000;
const POLL_MAX_MS = 30_000;

export interface CloudSqlTarget {
  /** Clave JSON de la service account; null = Application Default Credentials. */
  serviceAccountJson: string | null;
  project: string;
  instance: string;
}

export interface CloudSqlInstanceInfo {
  state: string;
  databaseVersion: string;
  region: string | null;
  serviceAccountEmail: string | null;
}

/** Error de la API con el código HTTP (para distinguir 403/404/409). */
export class CloudSqlError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "CloudSqlError";
  }
}

// ID de proyecto (admite los de dominio, `empresa.com:proyecto`) y nombre de instancia.
const PROJECT_RE = /^[a-z0-9.:-]{4,100}$/;
const INSTANCE_RE = /^[a-z][a-z0-9-]{0,97}$/;

/** Ruta base de la instancia, validando los identificadores (evita inyectar segmentos). */
function instancePath(t: CloudSqlTarget): string {
  if (!PROJECT_RE.test(t.project)) throw new CloudSqlError(`ID de proyecto GCP inválido: ${t.project}`, null);
  if (!INSTANCE_RE.test(t.instance)) throw new CloudSqlError(`Nombre de instancia Cloud SQL inválido: ${t.instance}`, null);
  return `/projects/${encodeURIComponent(t.project)}/instances/${encodeURIComponent(t.instance)}`;
}

function auth(serviceAccountJson: string | null): GoogleAuth {
  return new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/sqlservice.admin"],
    ...(serviceAccountJson
      ? { credentials: JSON.parse(serviceAccountJson) as Record<string, string> }
      : {}),
  });
}

interface GaxiosLikeError {
  message?: string;
  response?: { status?: number; data?: { error?: { message?: string } } };
}

/** Llama a la API y traduce los errores a `CloudSqlError` con un mensaje legible. */
async function call<T>(
  serviceAccountJson: string | null,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<T> {
  try {
    const client = await auth(serviceAccountJson).getClient();
    const res = await client.request<T>({ url: `${BASE}${path}`, method, data });
    return res.data;
  } catch (err) {
    const e = err as GaxiosLikeError;
    const status = e.response?.status ?? null;
    const apiMsg = e.response?.data?.error?.message ?? e.message ?? String(err);
    const hint =
      status === 403
        ? " (revisa los permisos de la service account sobre la instancia)"
        : status === 404
          ? " (revisa el proyecto y el nombre de la instancia)"
          : "";
    throw new CloudSqlError(`Cloud SQL API${status ? ` ${status}` : ""}: ${apiMsg}${hint}`, status);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Datos de la instancia (estado, versión, service account propia). */
export async function getInstance(t: CloudSqlTarget): Promise<CloudSqlInstanceInfo> {
  const r = await call<{
    state?: string;
    databaseVersion?: string;
    region?: string;
    serviceAccountEmailAddress?: string;
  }>(t.serviceAccountJson, "GET", instancePath(t));
  return {
    state: r.state ?? "UNKNOWN",
    databaseVersion: r.databaseVersion ?? "UNKNOWN",
    region: r.region ?? null,
    serviceAccountEmail: r.serviceAccountEmailAddress ?? null,
  };
}

/** BDs de usuario de la instancia (sin conectarse a ella; excluye las de sistema). */
export async function listDatabases(t: CloudSqlTarget): Promise<string[]> {
  const r = await call<{ items?: { name: string }[] }>(t.serviceAccountJson, "GET", `${instancePath(t)}/databases`);
  return (r.items ?? [])
    .map((d) => d.name)
    .filter((n) => !SQLSERVER_SYSTEM_DBS.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

interface Operation {
  name: string;
  status?: "PENDING" | "RUNNING" | "DONE" | "SQL_OPERATION_STATUS_UNSPECIFIED";
  error?: { errors?: { code?: string; message?: string }[] };
}

export interface ExportBakInput extends CloudSqlTarget {
  dbName: string;
  /** Destino `gs://bucket/ruta/archivo.bak`. */
  uri: string;
  /** Tope total (incluida la espera por instancia ocupada). */
  timeoutMs: number;
  /** Cada cuánto registrar "sigue en curso" mientras el estado no cambia. 0 = nunca. */
  heartbeatMs?: number;
  onLog?: (line: string) => void;
}

/**
 * Exporta una BD de SQL Server a `.bak` en GCS (backup FULL). Lo genera la propia
 * instancia; DBKeeper solo lanza la operación y la sigue hasta que termina.
 *
 * `differentialBase: false` lo deja como copy-only: no reinicia la base diferencial,
 * así no rompe la cadena de backups diferenciales que ya tenga la instancia.
 */
export async function exportSqlServerBak(input: ExportBakInput): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const log = input.onLog ?? (() => {});
  const body = {
    exportContext: {
      kind: "sql#exportContext",
      fileType: "BAK",
      uri: input.uri,
      databases: [input.dbName],
      bakExportOptions: { bakType: "FULL", differentialBase: false },
    },
  };

  // Lanzar el export; Cloud SQL admite una sola operación por instancia (409 = ocupada).
  let op: Operation | null = null;
  for (let attempt = 1; !op; attempt++) {
    try {
      op = await call<Operation>(input.serviceAccountJson, "POST", `${instancePath(input)}/export`, body);
    } catch (err) {
      const busy = err instanceof CloudSqlError && err.status === 409;
      if (!busy || attempt > BUSY_RETRIES || Date.now() + BUSY_WAIT_MS > deadline) throw err;
      log(`Instancia ocupada con otra operación; reintento ${attempt}/${BUSY_RETRIES} en ${BUSY_WAIT_MS / 1000} s…`);
      await sleep(BUSY_WAIT_MS);
    }
  }
  log(`Export iniciado (operación ${op.name}) → ${input.uri}`);

  // Seguir la operación hasta DONE (con error o sin él).
  const opPath = `/projects/${encodeURIComponent(input.project)}/operations/${encodeURIComponent(op.name)}`;
  let wait = POLL_MIN_MS;
  let lastStatus = op.status;
  const opStart = Date.now();
  const heartbeatMs = input.heartbeatMs ?? 0;
  let nextHeartbeat = opStart + heartbeatMs;
  while (op.status !== "DONE") {
    if (Date.now() + wait > deadline) {
      throw new CloudSqlError(
        `Tiempo de espera agotado; la operación ${op.name} puede seguir en curso en GCP`,
        null,
      );
    }
    await sleep(wait);
    wait = Math.min(wait * 2, POLL_MAX_MS);
    op = await call<Operation>(input.serviceAccountJson, "GET", opPath);
    if (op.status !== lastStatus) {
      log(`Estado de la operación: ${op.status}`);
      lastStatus = op.status;
    } else if (heartbeatMs > 0 && op.status !== "DONE" && Date.now() >= nextHeartbeat) {
      // Sin esto, un export largo no escribe nada en el log mientras sigue en RUNNING.
      const mins = Math.round((Date.now() - opStart) / 60_000);
      log(`Export en curso… ${mins} min transcurridos (estado ${op.status}).`);
      nextHeartbeat = Date.now() + heartbeatMs;
    }
  }

  const errors = op.error?.errors ?? [];
  if (errors.length > 0) {
    const msg = errors.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join("; ");
    throw new CloudSqlError(`El export falló en Cloud SQL: ${msg}`, null);
  }
}
