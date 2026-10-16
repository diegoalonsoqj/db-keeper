import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BACKUP_SETTINGS } from "@dbkeeper/shared";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { decryptSecret } from "../../../lib/crypto.js";
import { formatBytes } from "../../../lib/format.js";
import * as serversRepo from "../../servers/servers.repository.js";
import * as credsRepo from "../../credentials/credentials.repository.js";
import * as storageRepo from "../../storage/storage.repository.js";
import * as envRepo from "../../environments/environments.repository.js";
import * as repo from "../backups.repository.js";
import { getDumper } from "./index.js";
import { getGcsObjectInfo, uploadToGcs } from "./gcs.js";
import { hashFile, md5Base64ToHex } from "./checksum.js";
import { CloudSqlTimeoutError, exportSqlServerBak, resumeSqlServerExport } from "../../../lib/cloudsql.js";
import { getServiceAccountJson, resolveGcpServiceAccountJson } from "../../cloud-credentials/cloud-credentials.service.js";
import { backupSqlServer } from "./sqlserver.js";
import { notifyBackup, type BackupItemResult } from "../../notifications/notifications.service.js";
import { enforceRetentionForJob } from "../retention.js";
import { getBackupSettings } from "../../settings/settings.service.js";
import { emitExecution, emitLog, emitProgress } from "../events.js";
import { watchFileSize } from "./progress.js";
import { runParallelItems } from "./parallel-runner.js";

/**
 * Raíz local donde escribir los dumps: la ruta del destino local **por defecto**
 * (catálogo de Almacenamiento), o `BACKUP_DIR` si no hay ninguno. Se resuelve
 * contra el cwd si es relativa.
 */
async function resolveLocalRoot(): Promise<string> {
  const def = await storageRepo.findDefault("local");
  const base = def?.path?.trim() || env.BACKUP_DIR;
  return path.resolve(process.cwd(), base);
}

/** Ejecuciones en curso en este proceso (evita disparos duplicados). */
const inFlight = new Set<string>();

/** Tope de líneas de consola guardadas por ítem (para persistir en el log). */
const MAX_LOG_LINES = 2000;

interface LogStream {
  /** Recibe una línea del motor (la agrupa y la empuja por SSE). */
  onLog: (line: string) => void;
  /** Vacía el lote pendiente (al cerrar el ítem). */
  done: () => void;
  /** Texto acumulado para persistir en `execution_items.log` (o null si vacío). */
  getLog: () => string | null;
}

/**
 * Recolector de la salida en vivo de una BD: aplica el `scrub` (quita la
 * contraseña), acumula para persistir y empuja por SSE en lotes cortos (cada 300
 * ms o cada 50 líneas) para no saturar con eventos en dumps muy verbosos.
 * `initial`: log ya persistido (al retomar); se acumula sin volver a emitirlo.
 */
function makeLogStream(
  executionId: string,
  dbName: string,
  scrub: (l: string) => string,
  initial: string | null = null,
): LogStream {
  const all: string[] = initial ? initial.split("\n") : [];
  let pending: string[] = [];
  let timer: NodeJS.Timeout | null = null;
  const flush = (): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    emitLog(executionId, dbName, batch);
  };
  return {
    onLog(line) {
      const s = scrub(line);
      if (all.length < MAX_LOG_LINES) all.push(s);
      pending.push(s);
      if (pending.length >= 50) flush();
      else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          flush();
        }, 300);
        timer.unref?.();
      }
    },
    done() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    getLog: () => (all.length ? all.join("\n").slice(0, 64_000) : null),
  };
}

/** Quita cualquier rastro de la contraseña del mensaje de error y lo acota. */
function safeMessage(err: unknown, password: string): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (password) msg = msg.split(password).join("***");
  // Se conserva el final: ahí suele estar la causa del error.
  return msg.length > 2000 ? `…${msg.slice(-2000)}` : msg;
}

/** Marca de tiempo local `YYYYMMDD_HHMMSS` para el nombre del archivo. */
function timestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** Nombre de archivo seguro para el sistema de archivos. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
}

/**
 * Ejecuta una corrida: vuelca cada BD del snapshot (execution_items) y va
 * actualizando los estados. No lanza: cualquier fallo se refleja en la BD y se
 * loguea. Pensado para invocarse en segundo plano desde `runNow`.
 *
 * `resume`: retoma una ejecución que quedó en `running` tras un reinicio (solo
 * export de Cloud SQL, cuyas operaciones siguen corriendo en GCP).
 */
export async function runExecution(executionId: string, opts: { resume?: boolean } = {}): Promise<void> {
  if (inFlight.has(executionId)) return;
  inFlight.add(executionId);
  try {
    await execute(executionId, opts.resume ?? false);
  } catch (err) {
    logger.error({ err, executionId }, "Fallo no controlado en el motor de backups");
    await repo.finishExecution(executionId, "failed").catch(() => {});
  } finally {
    inFlight.delete(executionId);
  }
}

async function execute(executionId: string, resume: boolean): Promise<void> {
  const exec = await repo.findExecutionById(executionId);
  if (!exec) return;
  if (exec.status !== (resume ? "running" : "pending")) return; // ya procesada o en curso

  // Contexto para las notificaciones; se completa a medida que se resuelve la corrida.
  const startedAt = resume && exec.startedAt ? Date.parse(exec.startedAt) : Date.now();
  const dbNames = exec.items.map((i) => i.dbName);
  let jobName = "(desconocido)";
  let engine = "";
  let environment: string | null = null;
  let storage: string | null = null; // "Local" o "<bucket>/<ruta>", para el aviso.
  let instance: string | null = null;
  const runAt = new Date(exec.createdAt);

  /** Dispara el aviso correspondiente en segundo plano (notifyBackup nunca lanza). */
  const notify = (event: "start" | "success" | "failure", items?: BackupItemResult[]): void => {
    const isEnd = event !== "start";
    const totalBytes = items?.reduce((sum, it) => sum + (it.bytes ?? 0), 0) ?? null;
    void notifyBackup({
      event,
      executionId,
      runAt,
      instance,
      group: exec.groupName,
      jobName,
      engine,
      environment,
      databases: dbNames,
      storage,
      durationMs: isEnd ? Date.now() - startedAt : null,
      totalBytes: isEnd ? totalBytes : null,
      items: isEnd ? items : undefined,
    });
  };

  // Primera línea del log de cada BD: con qué método e instancia corrió (diagnóstico).
  let context: string | null = null;

  // Resolver el evento, la instancia y la credencial.
  const fail = async (reason: string): Promise<void> => {
    logger.warn({ executionId, reason, context }, "Ejecución de backup no realizable");
    const log = [context, reason].filter(Boolean).join("\n");
    for (const it of exec.items) {
      // `running` solo puede darse al retomar tras un reinicio.
      if (it.status === "pending" || it.status === "running") await repo.finishItem(it.id, { status: "failed", log });
    }
    await repo.finishExecution(executionId, "failed");
    await emitExecution(executionId);
    notify(
      "failure",
      exec.items.map((it) => ({ dbName: it.dbName, status: "failed" as const, error: reason })),
    );
  };

  if (!exec.jobId) return fail("El evento de backup ya no existe");
  const job = await repo.findJobById(exec.jobId);
  if (!job) return fail("El evento de backup ya no existe");
  jobName = job.name;
  context = `Método: ${job.method}`;
  if (resume && job.method !== "cloudsql_export") return fail("Interrumpida por reinicio del servicio");

  // Destino GCS (métodos gcloud, cloudsql_export y pg_parallel): resolver bucket + credencial.
  let gcs: { bucket: string; prefix: string | null; serviceAccountJson: string | null } | null = null;
  if (job.method === "gcloud" || job.method === "cloudsql_export" || job.method === "pg_parallel") {
    if (!job.bucketId) return fail("El evento no tiene bucket de destino");
    const target = await storageRepo.findById(job.bucketId);
    if (!target || target.type !== "bucket" || !target.bucket) {
      return fail("El bucket de destino ya no existe");
    }
    if (target.provider !== "gcp") {
      return fail(`El proveedor de nube '${target.provider}' aún no está implementado`);
    }
    if (!target.isActive) return fail(`El destino '${target.name}' está inactivo; actívalo o asigna otro al evento`);
    let saJson: string | null = null;
    try {
      // Lanza si la cuenta asignada está inactiva (no se sigue usando en silencio).
      if (target.cloudCredentialId) saJson = await getServiceAccountJson(target.cloudCredentialId);
    } catch (err) {
      return fail(safeMessage(err, ""));
    }
    gcs = { bucket: target.bucket, prefix: target.prefix, serviceAccountJson: saJson };
  }

  const server = await serversRepo.findById(job.serverId);
  if (!server) return fail("La instancia del evento ya no existe");
  engine = server.engine;
  instance = server.name;
  context +=
    ` · Instancia: ${server.name}` +
    (server.isCloudSql && server.gcpInstance ? ` (Cloud SQL ${server.gcpProject}/${server.gcpInstance})` : "");
  // Destino de almacenamiento para el aviso: bucket (con su ruta por instancia) o local.
  storage = gcs
    ? `${gcs.bucket}/${[gcs.prefix, safeFileName(server.name)].filter(Boolean).join("/")}`
    : "Local";

  // Los dumps se guardan en backups/<motor>/<instancia>/<archivo>. El nombre
  // ya lleva {db}_{ambiente}_{timestamp}; el id de la ejecución queda solo en la BD
  // (core.executions) como registro. Sin prefijo "backup_".
  // El evento guarda su ambiente (validado contra instancia y credencial); se usa
  // para el nombre, con la instancia como respaldo.
  const envCode = job.environment ?? server.environment;
  // Para el nombre del archivo se usa el código; en la notificación, el nombre del
  // ambiente del catálogo (p. ej. "PRD" → "Producción"), con el código de respaldo.
  environment = envCode ? ((await envRepo.findNameByCode(envCode)) ?? envCode) : null;
  const envSuffix = envCode ? `_${safeFileName(envCode)}` : "";
  const ts = timestamp(new Date());

  /** Cierra la corrida: estado final, aviso y retención (si hubo algún backup nuevo). */
  const finishRun = async (results: BackupItemResult[]): Promise<void> => {
    const allOk = results.every((r) => r.status === "success");
    await repo.finishExecution(executionId, allOk ? "success" : "failed");
    await emitExecution(executionId);
    notify(allOk ? "success" : "failure", results);
    // Aplica la retención del evento tras generar nuevos backups (limpieza por
    // cantidad inmediata). Fire-and-forget: nunca debe tumbar la corrida.
    if (results.some((r) => r.status === "success")) {
      void enforceRetentionForJob(job.id).catch((err) =>
        logger.error({ err, jobId: job.id }, "Fallo al aplicar la retención tras el backup"),
      );
    }
  };

  // Export de Cloud SQL: la propia instancia escribe el .bak en el bucket. No usa
  // credencial de BD ni se conecta a ella; solo la API de Cloud SQL Admin.
  if (job.method === "cloudsql_export") {
    if (!gcs) return fail("El evento no tiene bucket de destino");
    if (server.engine !== "sqlserver") return fail("El export de Cloud SQL solo está disponible para SQL Server");
    if (!server.isCloudSql || !server.gcpProject || !server.gcpInstance) {
      return fail("La instancia no está configurada como Cloud SQL (proyecto e instancia GCP)");
    }
    let saJson: string | null;
    try {
      saJson = await resolveGcpServiceAccountJson(server.cloudCredentialId);
    } catch (err) {
      return fail(safeMessage(err, "")); // p. ej. la cuenta de la instancia está inactiva
    }
    const target = {
      serviceAccountJson: saJson,
      project: server.gcpProject,
      instance: server.gcpInstance,
    };
    const bs = await getBackupSettings();
    const heartbeatMs = bs.cloudSqlHeartbeatMinutes * 60_000;
    // Tiempos editables en Configuración → Backups.
    const exportTimeoutMs = bs.cloudSqlExportTimeoutHours * 3_600_000;
    const verifyIntervalMs = bs.cloudSqlVerifyIntervalMinutes * 60_000;
    const exportMaxMs = bs.cloudSqlExportMaxHours * 3_600_000;
    // Al retomar: operaciones ya lanzadas antes del reinicio (itemId → operación).
    const operations = resume ? await repo.findItemOperations(executionId) : new Map<string, string>();
    if (!resume) {
      await repo.markExecutionRunning(executionId);
      await emitExecution(executionId);
      notify("start");
    }

    const results: BackupItemResult[] = [];
    for (const item of exec.items) {
      // Ítems ya cerrados antes del reinicio: cuentan para el resultado final.
      if (item.status === "success" || item.status === "failed") {
        if (resume) results.push({ dbName: item.dbName, status: item.status, bytes: item.fileBytes, error: item.log });
        continue;
      }
      const operationName = item.status === "running" ? operations.get(item.id) : undefined;
      if (item.status === "running" && (!operationName || !item.fileName)) {
        // El proceso murió antes de registrar la operación: no hay qué seguir.
        const reason = "Interrumpida por reinicio del servicio antes de lanzar el export";
        await repo.finishItem(item.id, { status: "failed", log: [item.log, reason].filter(Boolean).join("\n") });
        results.push({ dbName: item.dbName, status: "failed", error: reason });
        await emitExecution(executionId);
        continue;
      }
      if (item.status === "pending") {
        await repo.markItemRunning(item.id);
        await emitExecution(executionId);
      }
      const ls = makeLogStream(executionId, item.dbName, (l) => l, operationName ? item.log : null);
      if (!operationName && context) ls.onLog(context); // al retomar ya está en el log
      const start = operationName && item.startedAt ? Date.parse(item.startedAt) : Date.now();
      // Ya superó el timeout antes de esta pasada: es una verificación en segundo plano.
      // Margen de 1 min: el seguimiento corta hasta 30 s antes del deadline (no duerme
      // si la siguiente espera lo rebasa) y el verificador podría caer en ese hueco.
      const overdue = Boolean(operationName) && Date.now() + 60_000 >= start + exportTimeoutMs;
      try {
        let bucket = gcs.bucket;
        let objectName: string;
        let uri: string;
        if (operationName && item.fileName) {
          // Retomar: el destino es el registrado al lanzar (el evento pudo cambiar de bucket).
          const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(item.fileName);
          if (!m) throw new Error(`Destino registrado inválido: ${item.fileName}`);
          bucket = m[1]!;
          objectName = m[2]!;
          uri = item.fileName;
          // Si ya superó el timeout, resumeSqlServerExport hace una sola consulta.
          if (!overdue) {
            ls.onLog(`Servicio reiniciado: se retoma el seguimiento de la operación ${operationName}…`);
          }
          await resumeSqlServerExport({
            ...target,
            operationName,
            startedAt: start,
            deadline: start + exportTimeoutMs,
            heartbeatMs,
            onLog: ls.onLog,
          });
        } else {
          // Misma ruta que los dumps a bucket: <prefijo>/<instancia>/<bd>_<amb>_<ts>.bak
          objectName = [gcs.prefix, safeFileName(server.name), `${safeFileName(item.dbName)}${envSuffix}_${ts}.bak`]
            .filter(Boolean)
            .join("/");
          uri = `gs://${bucket}/${objectName}`;
          const exportUri = uri;
          await exportSqlServerBak({
            ...target,
            dbName: item.dbName,
            uri,
            timeoutMs: exportTimeoutMs,
            heartbeatMs,
            onLog: ls.onLog,
            onOperation: (name) => repo.setItemOperation(item.id, name, exportUri, ls.getLog()),
          });
        }
        // Verificación: el objeto debe existir en el bucket y no estar vacío.
        // El .bak nunca pasa por la API: los checksums son los que calcula GCS.
        const obj = await getGcsObjectInfo({ bucket, serviceAccountJson: gcs.serviceAccountJson }, objectName);
        const bytes = obj.bytes;
        if (bytes <= 0) throw new Error(`El export terminó pero ${uri} está vacío`);
        ls.onLog(`Export completado en ${((Date.now() - start) / 1000).toFixed(1)} s (${formatBytes(bytes)}).`);
        const md5 = md5Base64ToHex(obj.md5);
        ls.onLog(`Checksums (GCS): ${[md5 && `MD5 ${md5}`, obj.crc32c && `CRC32C ${obj.crc32c}`].filter(Boolean).join(" · ") || "no disponibles"}`);
        ls.done();
        await repo.finishItem(item.id, {
          status: "success",
          fileName: uri,
          fileBytes: bytes,
          log: ls.getLog(),
          checksums: { sha256: null, md5, crc32c: obj.crc32c },
        });
        results.push({ dbName: item.dbName, status: "success", bytes });
      } catch (err) {
        const elapsed = Date.now() - start;
        if (err instanceof CloudSqlTimeoutError && elapsed < exportMaxMs) {
          // El export sigue en GCP: no se da por fallido. El ítem queda en `running` y el
          // verificador periódico lo retoma; las BDs pendientes esperan (la instancia
          // solo admite una operación a la vez).
          const mins = Math.round(elapsed / 60_000);
          if (!overdue) {
            ls.onLog(
              `Se superó el tiempo de espera (${Math.round(exportTimeoutMs / 60_000)} min) y la ` +
                `operación ${err.operationName} sigue en curso en GCP. Se verificará en segundo plano cada ` +
                `${Math.round(verifyIntervalMs / 60_000)} min (hasta ${Math.round(exportMaxMs / 3_600_000)} h).`,
            );
          } else if (heartbeatMs > 0 && Math.floor(elapsed / heartbeatMs) > Math.floor((elapsed - verifyIntervalMs) / heartbeatMs)) {
            // Una línea por intervalo de heartbeat, aunque la verificación sea más frecuente.
            ls.onLog(`Verificación en segundo plano: el export sigue en curso… ${mins} min transcurridos.`);
          }
          ls.done();
          await repo.updateItemLog(item.id, ls.getLog());
          await emitExecution(executionId);
          return;
        }
        ls.done();
        const message =
          err instanceof CloudSqlTimeoutError
            ? `Se superó el tope de ${Math.round(exportMaxMs / 3_600_000)} h; se deja de verificar la operación ${err.operationName} (puede seguir en curso en GCP).`
            : safeMessage(err, "");
        // Conserva lo registrado (p. ej. el id de la operación) junto al error.
        const log = [ls.getLog(), message].filter(Boolean).join("\n");
        await repo.finishItem(item.id, { status: "failed", log });
        results.push({ dbName: item.dbName, status: "failed", error: message });
      }
      await emitExecution(executionId);
    }
    return finishRun(results);
  }

  // Dump (local o a bucket): se conecta a la BD, así que necesita host.
  if (!server.host) return fail("La instancia no tiene host/IP; este método se conecta a la BD (usa export de Cloud SQL o indica el host)");
  const host = server.host;
  const isSqlServer = server.engine === "sqlserver";
  if (!isSqlServer && !getDumper(server.engine)) {
    return fail(`El motor '${server.engine}' aún no está soportado por el motor de backups`);
  }

  const credentialId = job.credentialId ?? server.credentialId;
  if (!credentialId) return fail("No hay credencial asignada (ni en el evento ni en la instancia)");
  const cred = await credsRepo.findById(credentialId);
  const enc = await credsRepo.getEncrypted(credentialId);
  if (!cred || !enc) return fail("La credencial asignada ya no existe");
  const password = decryptSecret(enc.passwordEncrypted);
  // Corte por inactividad y tope total (Configuración → Backups).
  const bs = await getBackupSettings();
  const limits = { inactivityMs: bs.dumpInactivityMinutes * 60_000, maxMs: bs.dumpMaxHours * 3_600_000 };

  // Volcar cada BD secuencialmente.
  const compress = job.options.compress !== false; // por defecto comprimido
  const excludeTables = Array.isArray(job.options.excludeTables)
    ? job.options.excludeTables.map((t) => String(t).trim()).filter(Boolean)
    : [];
  // MongoDB: reglas de colecciones a excluir (el prefijo `<bd>.` se interpreta con las BDs del evento).
  const excludeCollections =
    server.engine === "mongo" && Array.isArray(job.options.excludeCollections)
      ? {
          rules: job.options.excludeCollections.map((r) => String(r).trim()).filter(Boolean),
          databases: job.databases,
          caseSensitive: job.options.excludeCollectionsCaseSensitive === true,
        }
      : undefined;
  // PostgreSQL: esquemas a excluir por BD ({ bd: [esquemas] }).
  const excludeSchemasByDb =
    job.options.excludeSchemas && typeof job.options.excludeSchemas === "object"
      ? (job.options.excludeSchemas as Record<string, unknown>)
      : {};
  const excludeSchemasFor = (db: string): string[] => {
    const list = excludeSchemasByDb[db];
    return Array.isArray(list) ? list.map((s) => String(s)).filter(Boolean) : [];
  };
  // PostgreSQL: extensiones a excluir por BD ({ bd: [extensiones] }).
  const excludeExtensionsByDb =
    job.options.excludeExtensions && typeof job.options.excludeExtensions === "object"
      ? (job.options.excludeExtensions as Record<string, unknown>)
      : {};
  const excludeExtensionsFor = (db: string): string[] => {
    const list = excludeExtensionsByDb[db];
    return Array.isArray(list) ? list.map((s) => String(s)).filter(Boolean) : [];
  };
  // PostgreSQL: event triggers a excluir por BD ({ bd: [triggers] }).
  const excludeEventTriggersByDb =
    job.options.excludeEventTriggers && typeof job.options.excludeEventTriggers === "object"
      ? (job.options.excludeEventTriggers as Record<string, unknown>)
      : {};
  const excludeEventTriggersFor = (db: string): string[] => {
    const list = excludeEventTriggersByDb[db];
    return Array.isArray(list) ? list.map((s) => String(s)).filter(Boolean) : [];
  };
  const cleanDefiners = job.options.cleanDefiners !== false; // MySQL: por defecto sí
  const pgCompat = job.options.pgCompat !== false; // PostgreSQL: por defecto sí
  // MongoDB: SRV (Atlas) según la instancia, o si el host es de Atlas (.mongodb.net).
  const mongoSrv = server.mongoSrv || host.endsWith(".mongodb.net");
  const verbose = job.options.verbose === true; // modo detallado (--verbose, consola en vivo)
  const keepLocalCopy = job.method === "gcloud" && job.options.keepLocalCopy === true;
  // Quita la contraseña de cualquier línea de consola antes de emitirla/guardarla.
  const scrub = (l: string): string => (password ? l.split(password).join("***") : l);

  // Dump paralelo (AlloyDB): disco temporal + pg_dump -Fd -j + subida de la carpeta.
  if (job.method === "pg_parallel") {
    if (!gcs) return fail("El evento no tiene bucket de destino");
    if (server.engine !== "postgres") return fail("El dump paralelo solo está disponible para PostgreSQL");
    await repo.markExecutionRunning(executionId);
    await emitExecution(executionId);
    notify("start");
    const results = await runParallelItems({
      executionId,
      runAt,
      group: exec.groupName,
      job,
      server,
      host,
      items: exec.items,
      gcs,
      user: cred.username,
      password,
      environment,
      envSuffix,
      ts,
      backupSettings: bs,
      context,
      compress,
      verbose,
      excludeTables,
      excludeSchemasFor,
      excludeExtensionsFor,
      excludeEventTriggersFor,
      makeLog: (db) => makeLogStream(executionId, db, scrub),
      safeFileName,
      safeMessage: (err) => safeMessage(err, password),
    });
    return finishRun(results);
  }
  // Extensión del archivo de dump (para vigilar su tamaño en vivo). Debe coincidir
  // con la que arma cada motor; si difiere, el watcher simplemente no reporta.
  const dumpExt =
    server.engine === "mongo"
      ? compress
        ? ".archive.gz"
        : ".archive"
      : compress
        ? ".sql.gz"
        : ".sql";
  // SQL Server: el .bak se escribe en una ruta del propio servidor (no se transmite).
  let sqlBackupDir = "";
  if (isSqlServer) {
    if (job.method === "gcloud") {
      return fail("SQL Server no soporta destino GCS aquí (el .bak queda en la instancia)");
    }
    const dir = typeof job.options.sqlBackupDir === "string" ? job.options.sqlBackupDir.trim() : "";
    if (!dir) return fail("Indica la carpeta de backup en la instancia (opción sqlBackupDir)");
    sqlBackupDir = dir;
  }
  // Destino local solo para motores que transmiten el dump al cliente (no SQL Server).
  let destDir = "";
  if (!isSqlServer) {
    // Dump local: el destino local por defecto no puede estar inactivo. Para `gcloud`
    // la carpeta solo es staging temporal antes de subir, así que no se exige.
    const def = await storageRepo.findDefault("local");
    if (job.method === "dump" && def && !def.isActive) {
      return fail(`El destino local por defecto '${def.name}' está inactivo; actívalo o elige otro por defecto`);
    }
    const localRoot = await resolveLocalRoot();
    destDir = path.join(localRoot, server.engine, safeFileName(server.name));
    await mkdir(destDir, { recursive: true });
  }
  await repo.markExecutionRunning(executionId);
  await emitExecution(executionId);
  notify("start");

  const results: BackupItemResult[] = [];
  for (const item of exec.items) {
    if (item.status !== "pending") continue;
    await repo.markItemRunning(item.id);
    await emitExecution(executionId);
    let localPath: string | undefined;
    const ls = isSqlServer ? undefined : makeLogStream(executionId, item.dbName, scrub);
    if (context) ls?.onLog(context);
    const excludedSchemas = excludeSchemasFor(item.dbName);
    if (excludedSchemas.length > 0) ls?.onLog(`Esquemas excluidos (no se respaldan): ${excludedSchemas.join(", ")}`);
    const excludedExtensions = excludeExtensionsFor(item.dbName);
    if (excludedExtensions.length > 0) {
      ls?.onLog(`Extensiones excluidas (no se respaldan): ${excludedExtensions.join(", ")}`);
    }
    const excludedEventTriggers = excludeEventTriggersFor(item.dbName);
    if (excludedEventTriggers.length > 0) {
      ls?.onLog(`Event triggers excluidos (no se respaldan): ${excludedEventTriggers.join(", ")}`);
    }
    let stopWatch = (): void => {};
    try {
      const fileBase = `${safeFileName(item.dbName)}${envSuffix}_${ts}`;
      // Progreso en vivo: vigila el tamaño del archivo de dump mientras crece.
      if (!isSqlServer) {
        const expectedPath = path.join(destDir, `${fileBase}${dumpExt}`);
        stopWatch = watchFileSize(expectedPath, (b) => emitProgress(executionId, item.dbName, b));
      }

      if (isSqlServer) {
        // BACKUP TO DISK en el servidor; peso/integridad vía el propio SQL Server.
        const res = await backupSqlServer({
          host,
          port: server.port,
          user: cred.username,
          password,
          ssl: server.useSsl,
          dbName: item.dbName,
          backupDir: sqlBackupDir,
          fileBase,
          compress,
          maxMs: limits.maxMs,
        });
        await repo.finishItem(item.id, { status: "success", fileName: res.filePath, fileBytes: res.bytes });
        results.push({ dbName: item.dbName, status: "success", bytes: res.bytes });
        await emitExecution(executionId);
        continue;
      }

      const dumper = getDumper(server.engine)!;
      const dumpRes = await dumper({
        host,
        port: server.port,
        user: cred.username,
        password,
        ssl: server.useSsl,
        dbName: item.dbName,
        compress,
        excludeTables,
        excludeSchemas: excludedSchemas,
        excludeExtensions: excludedExtensions,
        excludeEventTriggers: excludedEventTriggers,
        cleanDefiners,
        pgCompat,
        excludeCollections,
        mongoSrv,
        connOptions: server.connOptions,
        verbose,
        onLog: ls?.onLog,
        destPathNoExt: path.join(destDir, fileBase),
        limits,
      });
      localPath = dumpRes.filePath;

      // Huella del archivo tal como se generó: quien lo descargue puede verificarla.
      const hashes = await hashFile(localPath);
      ls?.onLog(`SHA-256: ${hashes.sha256}`);

      if (gcs) {
        // Subir el dump al bucket y borrar la copia local de staging (salvo keepLocalCopy).
        // Ruta en el bucket: <prefijo>/<instancia>/<archivo>. Se agrupa por nombre de
        // instancia (no por motor) para caer en las carpetas que el bucket ya tiene por
        // instancia. safeFileName conserva mayúsculas (GCS es case-sensitive).
        const objectName = [gcs.prefix, safeFileName(server.name), path.basename(localPath)]
          .filter(Boolean)
          .join("/");
        // Registrar la fase de subida en el mismo log de la BD (antes solo se logueaba
        // el dump; un evento a bucket no dejaba rastro de a dónde se subió ni cuánto tardó).
        ls?.onLog(`Subiendo a gs://${gcs.bucket}/${objectName} (${formatBytes(dumpRes.bytes)})…`);
        const upStart = Date.now();
        const gcsAuth = { bucket: gcs.bucket, serviceAccountJson: gcs.serviceAccountJson };
        const uri = await uploadToGcs(gcsAuth, localPath, objectName, { sha256: hashes.sha256 });
        ls?.onLog(`Subida completada en ${((Date.now() - upStart) / 1000).toFixed(1)} s.`);
        // El objeto en el bucket debe ser idéntico al dump local (antes de borrar el staging).
        const obj = await getGcsObjectInfo(gcsAuth, objectName);
        if (obj.crc32c !== hashes.crc32c || obj.bytes !== dumpRes.bytes) {
          throw new Error(
            `Integridad fallida: ${uri} no coincide con el dump local ` +
              `(CRC32C ${obj.crc32c ?? "?"} vs ${hashes.crc32c}, ${obj.bytes} vs ${dumpRes.bytes} bytes)`,
          );
        }
        ls?.onLog(`Integridad verificada en el bucket (CRC32C ${obj.crc32c}).`);
        if (keepLocalCopy) {
          ls?.onLog(`Copia local conservada: ${localPath}`);
        } else {
          await rm(localPath, { force: true });
          ls?.onLog("Copia local de staging eliminada.");
        }
        ls?.done();
        await repo.finishItem(item.id, {
          status: "success",
          fileName: uri,
          fileBytes: dumpRes.bytes,
          log: ls?.getLog(),
          checksums: { sha256: hashes.sha256, md5: md5Base64ToHex(obj.md5), crc32c: obj.crc32c },
        });
      } else {
        ls?.done();
        await repo.finishItem(item.id, {
          status: "success",
          fileName: localPath, // ruta absoluta (robusta si cambia el destino local)
          fileBytes: dumpRes.bytes,
          log: ls?.getLog(),
          checksums: { sha256: hashes.sha256, md5: hashes.md5, crc32c: hashes.crc32c },
        });
      }
      results.push({ dbName: item.dbName, status: "success", bytes: dumpRes.bytes });
    } catch (err) {
      ls?.done();
      const message = safeMessage(err, password);
      // Destino GCS: si el dump llegó a generarse (falló la subida o su verificación),
      // se conserva para no perderlo; los dumps parciales ya los borra cada dumper.
      const kept =
        gcs && localPath
          ? `Dump conservado en local: ${localPath}\nSúbelo con: gcloud storage cp "${localPath}" gs://${gcs.bucket}/${[gcs.prefix, safeFileName(server.name)].filter(Boolean).join("/")}/`
          : null;
      await repo.finishItem(item.id, {
        status: "failed",
        log: [context, message, kept].filter(Boolean).join("\n"),
      });
      results.push({ dbName: item.dbName, status: "failed", error: message });
    } finally {
      stopWatch();
    }
    await emitExecution(executionId); // estado del ítem recién cerrado (éxito/fallo)
  }

  await finishRun(results);
}

/**
 * Aviso de fallo para una ejecución cerrada por reinicio (la corrida murió con el
 * proceso y nunca llegó a notificar su fin). Nunca lanza.
 */
async function notifyInterrupted(executionId: string): Promise<void> {
  try {
    const exec = await repo.findExecutionById(executionId);
    if (!exec) return;
    const job = exec.jobId ? await repo.findJobById(exec.jobId) : null;
    const server = job ? await serversRepo.findById(job.serverId) : null;
    const envCode = exec.environment ?? job?.environment ?? server?.environment ?? null;
    const startedAt = exec.startedAt ? Date.parse(exec.startedAt) : null;
    const finishedAt = exec.finishedAt ? Date.parse(exec.finishedAt) : Date.now();
    await notifyBackup({
      event: "failure",
      executionId,
      runAt: new Date(exec.createdAt),
      instance: server?.name ?? null,
      group: exec.groupName,
      jobName: job?.name ?? exec.label,
      engine: server?.engine ?? "",
      environment: envCode ? ((await envRepo.findNameByCode(envCode)) ?? envCode) : null,
      databases: exec.items.map((i) => i.dbName),
      durationMs: startedAt ? finishedAt - startedAt : null,
      totalBytes: exec.items.reduce((sum, i) => sum + (i.fileBytes ?? 0), 0),
      items: exec.items.map((i) => ({
        dbName: i.dbName,
        status: i.status === "success" ? ("success" as const) : ("failed" as const),
        bytes: i.fileBytes,
        error: i.status === "success" ? null : i.log,
      })),
    });
  } catch (err) {
    logger.error({ err, executionId }, "No se pudo notificar la ejecución interrumpida");
  }
}

/**
 * Tras un reinicio: retoma los exports de Cloud SQL en curso (la operación sigue
 * en GCP) y cierra como fallidas las demás ejecuciones huérfanas. Se llama al
 * arrancar la API.
 */
export async function recoverStaleExecutions(): Promise<void> {
  try {
    const resumable = await repo.findResumableExecutionIds();
    const closed = await repo.recoverStaleExecutions(resumable);
    const staleVerifies = await repo.recoverStaleVerifications();
    if (staleVerifies > 0) logger.warn({ count: staleVerifies }, "Verificaciones de integridad interrumpidas por reinicio");
    if (closed.length > 0) {
      logger.warn({ count: closed.length }, "Ejecuciones de backup huérfanas marcadas como fallidas");
      for (const id of closed) void notifyInterrupted(id);
    }
    for (const id of resumable) {
      logger.info({ executionId: id }, "Retomando export de Cloud SQL tras reinicio");
      void runExecution(id, { resume: true });
    }
  } catch (err) {
    logger.error({ err }, "No se pudieron recuperar ejecuciones huérfanas");
  }
}

let verifyTimer: NodeJS.Timeout | null = null;

/**
 * Verificador periódico de exports de Cloud SQL que superaron el timeout: retoma
 * cada ejecución `cloudsql_export` en curso que no se esté procesando ya en este
 * proceso (las que sí, las cubre `inFlight`).
 */
export function startCloudSqlVerifier(): void {
  if (verifyTimer) return;
  // Se reprograma en cada vuelta leyendo el intervalo de Configuración → Backups,
  // así un cambio se aplica sin reiniciar.
  const schedule = async (): Promise<void> => {
    let intervalMs = DEFAULT_BACKUP_SETTINGS.cloudSqlVerifyIntervalMinutes * 60_000;
    try {
      intervalMs = (await getBackupSettings()).cloudSqlVerifyIntervalMinutes * 60_000;
    } catch (err) {
      logger.error({ err }, "No se pudo leer el intervalo del verificador; se usa el por defecto");
    }
    verifyTimer = setTimeout(() => {
      void repo
        .findResumableExecutionIds()
        .then((ids) => {
          for (const id of ids) if (!inFlight.has(id)) void runExecution(id, { resume: true });
        })
        .catch((err) => logger.error({ err }, "Fallo en el verificador de exports de Cloud SQL"))
        .finally(() => void schedule());
    }, intervalMs);
    verifyTimer.unref();
  };
  void schedule();
}
