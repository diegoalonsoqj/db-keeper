import { rm } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import type { BackupJobDto, BackupSettings, ExecutionItemDto, ServerDto } from "@dbkeeper/shared";
import { logger } from "../../../config/logger.js";
import { formatBytes } from "../../../lib/format.js";
import { getScratchSettings } from "../../settings/settings.service.js";
import { notifyBackup, type BackupItemResult } from "../../notifications/notifications.service.js";
import * as repo from "../backups.repository.js";
import { emitExecution, emitLog, emitProgress } from "../events.js";
import { readParallelOptions } from "../parallel-options.js";
import { activeCancellableIds, cancelReason, registerCancellable, unregisterCancellable } from "./cancel.js";
import { computeDiskSize } from "./disk-size.js";
import { uploadDirectoryToGcs } from "./gcs-dir.js";
import { dirSize, dumpPostgresDirectory, RESTORE_LIST } from "./pg-parallel.js";
import { getPgDumpMajor } from "./postgres.js";
import { watchFileSize } from "./progress.js";
import {
  collectOrphanScratchDisks,
  provisionScratchDisk,
  releaseScratchDisk,
  resolveScratchContext,
  scratchDiskName,
  type ScratchContext,
} from "./scratch-disk.js";

/** Consola en vivo de una BD (la que arma el runner). */
export interface ItemLog {
  onLog: (line: string) => void;
  done: () => void;
  getLog: () => string | null;
}

export interface ParallelRunInput {
  executionId: string;
  /** Fecha de la ejecución (para el asunto del aviso, el mismo en todo el hilo). */
  runAt: Date;
  job: BackupJobDto;
  server: ServerDto;
  host: string;
  items: ExecutionItemDto[];
  gcs: { bucket: string; prefix: string | null; serviceAccountJson: string | null };
  user: string;
  password: string;
  environment: string | null;
  /** Sufijo `_<ambiente>` y marca de tiempo del nombre (los mismos del resto de dumps). */
  envSuffix: string;
  ts: string;
  backupSettings: BackupSettings;
  /** Primera línea del log de cada BD (método e instancia). */
  context: string | null;
  compress: boolean;
  verbose: boolean;
  excludeTables: string[];
  excludeSchemasFor: (db: string) => string[];
  excludeExtensionsFor: (db: string) => string[];
  excludeEventTriggersFor: (db: string) => string[];
  makeLog: (dbName: string) => ItemLog;
  safeFileName: (name: string) => string;
  safeMessage: (err: unknown) => string;
}

/**
 * Ejecuta un evento `pg_parallel`: crea y monta un disco temporal NUEVO, vuelca
 * cada BD con `pg_dump -Fd -j N`, sube la carpeta al bucket (verificada) y borra la
 * copia local; al final (siempre, también si falla o se cancela) libera el disco.
 * Un dump exitoso nunca se pierde: la carpeta local solo se borra tras subirla y
 * verificarla, y el disco solo se libera al terminar todas las BDs.
 */
export async function runParallelItems(input: ParallelRunInput): Promise<BackupItemResult[]> {
  const { executionId, job } = input;
  const signal = registerCancellable(executionId);
  const opts = readParallelOptions(job.options, cpus().length);
  const results: BackupItemResult[] = [];
  /** Líneas del aprovisionamiento del disco: van al log de la primera BD. */
  const preamble: string[] = [];
  const pre = (line: string): void => void preamble.push(line);
  let ctx: ScratchContext | null = null;
  let diskName: string | null = null;
  let uploadConcurrency = 1;
  let lastItem: { id: string; dbName: string } | null = null;

  const pending = input.items.filter((i) => i.status === "pending");
  try {
    let setupError: string | null = null;
    try {
      const scratch = await getScratchSettings();
      if (!scratch.enabled) throw new Error("El disco temporal está deshabilitado (Configuración → Disco temporal)");
      ctx = await resolveScratchContext(scratch);
      uploadConcurrency = scratch.uploadConcurrency;
      const lastBytes = await repo.findLastSuccessBytes(job.id, pending.map((i) => i.dbName));
      const size = computeDiskSize({
        override: opts.diskSizeGb,
        defaultSizeGb: scratch.defaultSizeGb,
        maxSizeGb: scratch.maxSizeGb,
        sizeMarginPct: scratch.sizeMarginPct,
        lastBytes,
      });
      pre(`Disco temporal: ${size.sizeGb} GB (${size.reason}).`);
      if (size.warning) pre(`Aviso: ${size.warning}`);
      // Se fija antes de crear: si el aprovisionamiento falla a mitad, el finally libera.
      diskName = scratchDiskName(executionId);
      await provisionScratchDisk(ctx, {
        executionId,
        sizeGb: size.sizeGb,
        diskType: opts.diskType ?? scratch.diskType,
        signal,
        log: pre,
      });
    } catch (err) {
      setupError = signal.aborted ? (cancelReason(executionId) ?? "Cancelada") : input.safeMessage(err);
    }

    if (setupError) {
      const log = [input.context, ...preamble, setupError].filter(Boolean).join("\n");
      for (const item of pending) {
        await repo.finishItem(item.id, { status: "failed", log });
        results.push({ dbName: item.dbName, status: "failed", error: setupError });
      }
      await emitExecution(executionId);
      return results;
    }

    const pgDumpMajor = await getPgDumpMajor();
    for (const [idx, item] of pending.entries()) {
      if (signal.aborted) {
        const reason = cancelReason(executionId) ?? "Cancelada";
        await repo.finishItem(item.id, { status: "failed", log: reason });
        results.push({ dbName: item.dbName, status: "failed", error: reason });
        continue;
      }
      results.push(await runItem(input, item, { ctx: ctx!, diskName: diskName!, signal, opts, pgDumpMajor, uploadConcurrency, preamble: idx === 0 ? preamble : null }));
      lastItem = { id: item.id, dbName: item.dbName };
      await emitExecution(executionId);
    }
    return results;
  } finally {
    if (ctx && diskName) await release(input, ctx, diskName, lastItem);
    unregisterCancellable(executionId);
  }
}

async function runItem(
  input: ParallelRunInput,
  item: ExecutionItemDto,
  p: {
    ctx: ScratchContext;
    diskName: string;
    signal: AbortSignal;
    opts: ReturnType<typeof readParallelOptions>;
    pgDumpMajor: number | null;
    uploadConcurrency: number;
    preamble: string[] | null;
  },
): Promise<BackupItemResult> {
  const { executionId } = input;
  await repo.markItemRunning(item.id);
  await emitExecution(executionId);
  const ls = input.makeLog(item.dbName);
  if (input.context) ls.onLog(input.context);
  if (p.preamble) p.preamble.forEach((l) => ls.onLog(l));
  else ls.onLog(`Disco temporal ${p.diskName} montado en ${p.ctx.mountPoint}.`);

  const name = `${input.safeFileName(item.dbName)}${input.envSuffix}_${input.ts}`;
  const dir = path.join(p.ctx.mountPoint, name);
  const excludeSchemas = input.excludeSchemasFor(item.dbName);
  const excludeExtensions = input.excludeExtensionsFor(item.dbName);
  const excludeEventTriggers = input.excludeEventTriggersFor(item.dbName);
  const bs = input.backupSettings;
  const maxHours = Math.min(p.opts.maxHours, bs.dumpMaxHours);
  ls.onLog(
    `pg_dump ${p.pgDumpMajor ?? "?"} -Fd -j ${p.opts.parallelJobs} · permisos: ${p.opts.noPrivileges ? "omitidos (--no-privileges)" : "se conservan"}` +
      ` · ${input.compress ? "comprimido" : "sin comprimir"} · máx. ${maxHours} h`,
  );
  if (excludeSchemas.length) ls.onLog(`Esquemas excluidos (no se respaldan): ${excludeSchemas.join(", ")}`);
  if (excludeExtensions.length) ls.onLog(`Extensiones excluidas (no se respaldan): ${excludeExtensions.join(", ")}`);

  const stopWatch = watchFileSize(
    () => dirSize(dir).then((s) => s.bytes).catch(() => 0),
    (b) => emitProgress(executionId, item.dbName, b),
    5_000,
  );
  try {
    const dumpStart = Date.now();
    const dump = await dumpPostgresDirectory({
      host: input.host,
      port: input.server.port,
      user: input.user,
      password: input.password,
      ssl: input.server.useSsl,
      dbName: item.dbName,
      jobs: p.opts.parallelJobs,
      compress: input.compress,
      noPrivileges: p.opts.noPrivileges,
      excludeTables: input.excludeTables,
      excludeSchemas,
      excludeExtensions,
      excludeEventTriggers,
      verbose: input.verbose,
      stderrIgnore: p.opts.stderrIgnore,
      destDir: dir,
      limits: { inactivityMs: bs.dumpInactivityMinutes * 60_000, maxMs: maxHours * 3_600_000 },
      signal: p.signal,
      onLog: ls.onLog,
    });
    stopWatch();
    ls.onLog(
      `Dump completado en ${((Date.now() - dumpStart) / 60_000).toFixed(1)} min: ${dump.files} archivos, ${formatBytes(dump.bytes)}, ` +
        `TOC con ${dump.tocEntries} entradas (pg_restore --list OK).` +
        (dump.ignoredLines ? ` ${dump.ignoredLines} líneas de ruido omitidas.` : ""),
    );
    if (excludeEventTriggers.length) {
      ls.onLog(
        `Event triggers excluidos en ${RESTORE_LIST} (restaurar con pg_restore -L): ${dump.skippedEventTriggers.join(", ") || "ninguno encontrado"}`,
      );
    }

    const prefix = [input.gcs.prefix, input.safeFileName(input.server.name), name].filter(Boolean).join("/");
    const restoreDir = `/restore/${name}`;
    const up = await uploadDirectoryToGcs({ bucket: input.gcs.bucket, serviceAccountJson: input.gcs.serviceAccountJson }, dir, prefix, {
      concurrency: p.uploadConcurrency,
      signal: p.signal,
      onLog: ls.onLog,
      manifestExtra: {
        dbName: item.dbName,
        instance: input.server.name,
        alloydb: input.server.isAlloyDb,
        environment: input.environment,
        executionId,
        pgDumpMajor: p.pgDumpMajor,
        options: {
          parallelJobs: p.opts.parallelJobs,
          noPrivileges: p.opts.noPrivileges,
          compress: input.compress,
          excludeTables: input.excludeTables,
          excludeSchemas,
          excludeExtensions,
          excludeEventTriggers,
        },
        tocEntries: dump.tocEntries,
        restore: {
          note: p.pgDumpMajor
            ? `Requiere pg_restore ${p.pgDumpMajor} o superior (versión del pg_dump que lo generó).`
            : "Requiere pg_restore de versión igual o mayor que el pg_dump que lo generó.",
          commands: [
            `gcloud storage cp -r gs://${input.gcs.bucket}/${prefix} /restore/`,
            `pg_restore -j 8 --no-owner -d <bd_destino>${excludeEventTriggers.length ? ` -L ${restoreDir}/${RESTORE_LIST}` : ""} ${restoreDir}`,
          ],
        },
      },
    });
    // Solo tras subir y verificar: se libera espacio para la siguiente BD.
    await rm(dir, { recursive: true, force: true });
    ls.onLog("Carpeta local eliminada del disco temporal.");
    ls.done();
    await repo.finishItem(item.id, {
      status: "success",
      fileName: up.uri,
      fileBytes: up.bytes,
      log: ls.getLog(),
      checksums: { sha256: up.manifest.sha256, md5: up.manifest.md5, crc32c: up.manifest.crc32c },
    });
    return { dbName: item.dbName, status: "success", bytes: up.bytes };
  } catch (err) {
    stopWatch();
    const message = p.signal.aborted ? (cancelReason(executionId) ?? "Cancelada") : input.safeMessage(err);
    // La carpeta parcial ocuparía el disco que necesita la siguiente BD.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    ls.onLog(message);
    ls.done();
    await repo.finishItem(item.id, { status: "failed", log: ls.getLog() });
    return { dbName: item.dbName, status: "failed", error: message };
  }
}

/** Libera el disco; si falla, lo deja registrado en el log y avisa (sigue facturando). */
async function release(
  input: ParallelRunInput,
  ctx: ScratchContext,
  diskName: string,
  lastItem: { id: string; dbName: string } | null,
): Promise<void> {
  const lines: string[] = [];
  const log = (l: string): void => void lines.push(l);
  try {
    await releaseScratchDisk(ctx, diskName, log);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`ERROR liberando el disco temporal: ${msg}`);
    logger.error({ err, executionId: input.executionId, disk: diskName }, "No se pudo liberar el disco temporal");
    // Mismo evento (no "… — disco temporal") para que el aviso caiga en el hilo de la ejecución.
    void notifyBackup({
      event: "failure",
      executionId: input.executionId,
      runAt: input.runAt,
      instance: input.server.name,
      jobName: input.job.name,
      engine: input.server.engine,
      environment: input.environment,
      databases: [],
      storage: `${ctx.target.zone}/${diskName}`,
      items: [{ dbName: `Disco temporal ${diskName}`, status: "failed", error: msg }],
    });
  }
  if (lastItem) {
    emitLog(input.executionId, lastItem.dbName, lines);
    const exec = await repo.findExecutionById(input.executionId);
    const prev = exec?.items.find((i) => i.id === lastItem.id)?.log ?? null;
    await repo.updateItemLog(lastItem.id, [prev, ...lines].filter(Boolean).join("\n").slice(-64_000));
  } else {
    logger.info({ executionId: input.executionId, disk: diskName, lines }, "Liberación del disco temporal");
  }
}

let gcTimer: NodeJS.Timeout | null = null;

/**
 * Recolector de discos temporales huérfanos: al arrancar y cada N minutos
 * (Configuración → Disco temporal). Solo actúa si el disco temporal está
 * habilitado y DBKeeper corre en GCE.
 */
export function startScratchGc(): void {
  if (gcTimer) return;
  const tick = async (): Promise<void> => {
    let minutes = 30;
    try {
      const settings = await getScratchSettings();
      minutes = settings.gcIntervalMinutes;
      if (settings.enabled) await collectOrphanScratchDisks(settings, activeCancellableIds());
    } catch (err) {
      logger.error({ err }, "Fallo en el recolector de discos temporales");
    }
    gcTimer = setTimeout(() => void tick(), minutes * 60_000);
    gcTimer.unref();
  };
  // Primera pasada tras el arranque (después de recoverStaleExecutions).
  gcTimer = setTimeout(() => void tick(), 60_000);
  gcTimer.unref();
}
