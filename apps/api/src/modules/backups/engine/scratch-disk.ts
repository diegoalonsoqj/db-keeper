import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { mountPointError, type ScratchCheckDto, type ScratchDiskSettings } from "@dbkeeper/shared";
import { env, pgRestorePath } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { detectInstanceIdentity } from "../../../lib/gce-metadata.js";
import {
  attachDisk,
  createDisk,
  deleteDisk,
  detachDisk,
  getDisk,
  listDisksByLabel,
  missingProjectPermissions,
  SCRATCH_PERMISSIONS,
  type ComputeTarget,
} from "../../../lib/compute.js";
import { resolveGcpServiceAccountJson } from "../../cloud-credentials/cloud-credentials.service.js";

/** Etiquetas del disco: lo identifican como temporal y lo atan a su ejecución (GC). */
const LABEL_KEY = "dbkeeper";
const LABEL_VALUE = "scratch";
const EXEC_LABEL = "dbkeeper-exec";

const OP_TIMEOUT_MS = 10 * 60_000;
/** mkfs con inicialización completa de un disco de >1 TB puede tardar varios minutos. */
const PREPARE_TIMEOUT_MS = 30 * 60_000;
const HELPER_TIMEOUT_MS = 5 * 60_000;

export interface ScratchContext {
  target: ComputeTarget;
  /** Nombre de la VM donde corre DBKeeper (a la que se adjunta el disco). */
  instance: string;
  mountPoint: string;
}

/** El disco temporal quedó montado o adjuntado: requiere revisión manual (costo). */
export class ScratchRetainedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScratchRetainedError";
  }
}

/** Nombre del disco (y device-name) de una ejecución; el helper exige `dbk-scratch-*`. */
export function scratchDiskName(executionId: string): string {
  return `dbk-scratch-${executionId.replace(/-/g, "").slice(0, 16).toLowerCase()}`;
}

/** Proyecto/zona/VM (metadatos) + credencial de Configuración → Disco temporal. */
export async function resolveScratchContext(settings: ScratchDiskSettings): Promise<ScratchContext> {
  const err = mountPointError(settings.mountPoint);
  if (err) throw new Error(`Punto de montaje inválido (${settings.mountPoint}): ${err}`);
  const vm = await detectInstanceIdentity();
  if (!vm) throw new Error("DBKeeper no corre en una VM de Compute Engine: el disco temporal no está disponible");
  const serviceAccountJson = await resolveGcpServiceAccountJson(settings.cloudCredentialId);
  return { target: { serviceAccountJson, project: vm.project, zone: vm.zone }, instance: vm.instance, mountPoint: settings.mountPoint };
}

/** Invoca el helper root con `sudo -n` (sin shell). Devuelve su salida o lanza con su "ERR …". */
export function runHelper(args: string[], timeoutMs = HELPER_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(env.SUDO_PATH, ["-n", env.SCRATCH_HELPER_PATH, ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve(String(stdout).trim());
      const out = String(stderr).trim() || String(stdout).trim();
      const hint = /a password is required|not allowed|no tty|sudoers/i.test(out)
        ? " (falta la regla de sudoers; ver ops/README-scratch.md)"
        : (err as NodeJS.ErrnoException).code === "ENOENT"
          ? ` (no se encontró ${env.SUDO_PATH})`
          : "";
      reject(new Error(`Helper del disco temporal (${args[0]}): ${out || err.message}${hint}`));
    });
  });
}

const attachedTo = (users: string[], instance: string): boolean => users.some((u) => u.endsWith(`/instances/${instance}`));

/**
 * Crea un disco nuevo, lo adjunta a esta VM y lo formatea/monta con el helper. Si
 * algo falla a mitad, el llamador debe invocar `releaseScratchDisk` (lo hace en su
 * `finally`), que limpia cualquier estado parcial.
 */
export async function provisionScratchDisk(
  ctx: ScratchContext,
  p: { executionId: string; sizeGb: number; diskType: string; signal?: AbortSignal; log: (line: string) => void },
): Promise<string> {
  const name = scratchDiskName(p.executionId);
  const checkAbort = (): void => {
    if (p.signal?.aborted) throw new Error("Cancelada");
  };
  // Antes de crear (y pagar) el disco: el punto de montaje debe estar libre.
  await runHelper(["check", ctx.mountPoint]);
  checkAbort();
  p.log(`Creando disco ${name} (${p.sizeGb} GB, ${p.diskType}) en ${ctx.target.zone}…`);
  await createDisk(
    ctx.target,
    { name, sizeGb: p.sizeGb, type: p.diskType, labels: { [LABEL_KEY]: LABEL_VALUE, [EXEC_LABEL]: p.executionId } },
    OP_TIMEOUT_MS,
  );
  checkAbort();
  p.log(`Adjuntando ${name} a la VM ${ctx.instance}…`);
  await attachDisk(ctx.target, ctx.instance, name, name, OP_TIMEOUT_MS);
  checkAbort();
  p.log(`Formateando y montando en ${ctx.mountPoint}…`);
  await runHelper(["prepare", name, ctx.mountPoint], PREPARE_TIMEOUT_MS);
  p.log(`Disco ${name} montado en ${ctx.mountPoint}.`);
  return name;
}

/**
 * Desmonta (sync, nunca lazy), desadjunta y borra el disco. Si no se puede
 * desmontar, NO lo desadjunta ni lo borra (lanza `ScratchRetainedError`): borrar un
 * disco montado podría perder datos y esconder el problema.
 */
export async function releaseScratchDisk(ctx: ScratchContext, name: string, log: (line: string) => void): Promise<void> {
  try {
    await runHelper(["release", ctx.mountPoint]);
  } catch (err) {
    throw new ScratchRetainedError(
      `No se pudo desmontar ${ctx.mountPoint}; el disco ${name} queda adjuntado para revisión manual (sigue facturando). ${(err as Error).message}`,
    );
  }
  const disk = await getDisk(ctx.target, name);
  if (!disk) {
    log(`Disco ${name}: no existía (nada que borrar).`);
    return;
  }
  if (attachedTo(disk.users, ctx.instance)) {
    log(`Desadjuntando ${name}…`);
    await detachDisk(ctx.target, ctx.instance, name, OP_TIMEOUT_MS);
  } else if (disk.users.length > 0) {
    throw new ScratchRetainedError(`El disco ${name} está adjuntado a otra VM (${disk.users.join(", ")}); no se borra`);
  }
  log(`Borrando ${name}…`);
  await deleteDisk(ctx.target, name, OP_TIMEOUT_MS);
  log(`Disco ${name} eliminado.`);
}

/**
 * Libera discos temporales huérfanos (de ejecuciones que ya no corren en este
 * proceso: reinicio, caída). Solo toca discos con la etiqueta `dbkeeper=scratch`.
 * Si hay una ejecución con disco en curso, no se desmonta nada (el montaje es suyo):
 * solo se desadjuntan/borran los huérfanos que no están montados.
 */
export async function collectOrphanScratchDisks(settings: ScratchDiskSettings, activeIds: Set<string>): Promise<number> {
  const ctx = await resolveScratchContext(settings);
  const disks = await listDisksByLabel(ctx.target, LABEL_KEY, LABEL_VALUE);
  let freed = 0;
  for (const d of disks) {
    const exec = d.labels[EXEC_LABEL] ?? "";
    if (activeIds.has(exec)) continue;
    const log = (line: string): void => logger.info({ disk: d.name, executionId: exec }, line);
    try {
      if (activeIds.size === 0) {
        await releaseScratchDisk(ctx, d.name, log);
      } else if (!d.users.length || attachedTo(d.users, ctx.instance)) {
        // Con otra ejecución montada, el montaje es de ella: solo se quita el huérfano.
        if (d.users.length) await detachDisk(ctx.target, ctx.instance, d.name, OP_TIMEOUT_MS);
        await deleteDisk(ctx.target, d.name, OP_TIMEOUT_MS);
      } else {
        logger.warn({ disk: d.name, users: d.users }, "Disco temporal huérfano adjuntado a otra VM; no se toca");
        continue;
      }
      freed++;
      logger.warn({ disk: d.name, executionId: exec }, "Disco temporal huérfano liberado");
    } catch (err) {
      logger.error({ err, disk: d.name, executionId: exec }, "No se pudo liberar un disco temporal huérfano");
    }
  }
  return freed;
}

function binaryVersion(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ["--version"], { timeout: 10_000, windowsHide: true }, (err, stdout) =>
      err ? reject(new Error(`No se encontró ${bin}`)) : resolve(String(stdout).trim()),
    );
  });
}

/** "Probar configuración": comprueba todo lo necesario sin crear ningún recurso. */
export async function preflightScratch(settings: ScratchDiskSettings): Promise<ScratchCheckDto> {
  const checks: ScratchCheckDto["checks"] = [];
  const add = (label: string, ok: boolean, detail: string | null): void => void checks.push({ label, ok, detail });

  const mpErr = mountPointError(settings.mountPoint);
  add("Punto de montaje", !mpErr, mpErr ?? settings.mountPoint);

  const vm = await detectInstanceIdentity();
  add(
    "VM de Compute Engine",
    Boolean(vm),
    vm
      ? `${vm.project} · ${vm.zone} · ${vm.instance}${vm.machineType ? ` (${vm.machineType})` : ""} · ${cpus().length} vCPU`
      : "DBKeeper no corre en GCE (sin servidor de metadatos)",
  );

  let saJson: string | null = null;
  try {
    saJson = await resolveGcpServiceAccountJson(settings.cloudCredentialId);
    add("Credencial GCP", true, saJson ? "Cuenta de servicio del catálogo" : "Cuenta de la VM (ADC)");
  } catch (err) {
    add("Credencial GCP", false, (err as Error).message);
  }

  if (vm) {
    try {
      const missing = await missingProjectPermissions(saJson, vm.project, SCRATCH_PERMISSIONS);
      add("Permisos de Compute Engine", missing.length === 0, missing.length ? `Faltan: ${missing.join(", ")}` : "Completos");
    } catch (err) {
      add("Permisos de Compute Engine", false, `No se pudieron comprobar: ${(err as Error).message}`);
    }
  }

  if (!mpErr) {
    try {
      add("Helper root (sudo)", true, await runHelper(["check", settings.mountPoint]));
    } catch (err) {
      add("Helper root (sudo)", false, (err as Error).message);
    }
  }

  for (const bin of [env.PG_DUMP_PATH, pgRestorePath]) {
    try {
      add(bin, true, await binaryVersion(bin));
    } catch (err) {
      add(bin, false, (err as Error).message);
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
