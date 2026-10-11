import { z } from "zod";
import {
  ALLOYDB_STDERR_IGNORE,
  DEFAULT_PARALLEL_MAX_HOURS,
  PARALLEL_DUMP_LIMITS as L,
  SCRATCH_DISK_TYPES,
  suggestParallelJobs,
  type BackupMethod,
  type ParallelDumpOptions,
} from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";

/** Claves propias del método pg_parallel dentro de `options`. */
const PARALLEL_KEYS = ["parallelJobs", "noPrivileges", "diskSizeGb", "diskType", "maxHours", "stderrIgnore"] as const;
/** Opciones del dump plano que no aplican al formato directorio. */
const PLAIN_ONLY_KEYS = ["pgCompat", "cleanDefiners", "sqlBackupDir"] as const;

export interface ParallelContext {
  vcpus: number;
  maxSizeGb: number;
  /** Tope global de duración de dumps (Configuración → Backups). */
  dumpMaxHours: number;
  /** La instancia es AlloyDB: el filtro de ruido se precarga si no viene. */
  isAlloyDb: boolean;
}

/**
 * Valida y normaliza las opciones de un evento. Con `pg_parallel` valida sus claves
 * (con defaults) y quita las del dump plano; con otro método quita las de
 * `pg_parallel` (para no dejar valores huérfanos). Lanza 400 ante valores inválidos.
 */
export function normalizeParallelOptions(
  options: Record<string, unknown>,
  method: BackupMethod,
  ctx: ParallelContext,
): Record<string, unknown> {
  const next = { ...options };
  if (method !== "pg_parallel") {
    for (const k of PARALLEL_KEYS) delete next[k];
    return next;
  }
  const maxHoursCap = Math.min(L.maxHours.max, ctx.dumpMaxHours);
  const schema = z.object({
    parallelJobs: z.number().int().min(L.parallelJobs.min).max(L.parallelJobs.max).default(suggestParallelJobs(ctx.vcpus)),
    noPrivileges: z.boolean().default(false),
    diskSizeGb: z.number().int().min(10).max(ctx.maxSizeGb).nullable().default(null),
    diskType: z.enum(SCRATCH_DISK_TYPES).nullable().default(null),
    maxHours: z.number().int().min(L.maxHours.min).max(maxHoursCap).default(Math.min(DEFAULT_PARALLEL_MAX_HOURS, maxHoursCap)),
    stderrIgnore: z
      .array(z.string().trim().max(L.stderrIgnoreLength))
      .max(L.stderrIgnoreLines)
      .transform((a) => [...new Set(a.filter(Boolean))])
      .default(ctx.isAlloyDb ? ALLOYDB_STDERR_IGNORE : []),
  });
  const picked = Object.fromEntries(PARALLEL_KEYS.filter((k) => next[k] !== undefined).map((k) => [k, next[k]]));
  const parsed = schema.safeParse(picked);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw HttpError.badRequest(`Dump paralelo — ${String(issue.path[0] ?? "opciones")}: ${issue.message}`);
  }
  const opts: ParallelDumpOptions = parsed.data;
  for (const k of PLAIN_ONLY_KEYS) delete next[k];
  return { ...next, ...opts };
}

/** Lee las opciones guardadas de un evento pg_parallel (tolerante; ya validadas al guardar). */
export function readParallelOptions(options: Record<string, unknown>, vcpus: number): ParallelDumpOptions {
  const int = (v: unknown, def: number): number => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : def);
  return {
    parallelJobs: int(options.parallelJobs, suggestParallelJobs(vcpus)),
    noPrivileges: options.noPrivileges === true,
    diskSizeGb: typeof options.diskSizeGb === "number" ? options.diskSizeGb : null,
    diskType: (SCRATCH_DISK_TYPES as readonly string[]).includes(options.diskType as string)
      ? (options.diskType as ParallelDumpOptions["diskType"])
      : null,
    maxHours: int(options.maxHours, DEFAULT_PARALLEL_MAX_HOURS),
    stderrIgnore: Array.isArray(options.stderrIgnore) ? options.stderrIgnore.map(String).filter(Boolean) : [],
  };
}
