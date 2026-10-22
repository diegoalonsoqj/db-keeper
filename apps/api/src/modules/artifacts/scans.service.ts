import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { StorageScanDto } from "@dbkeeper/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../lib/http-error.js";
import { INSTANCE_HOST } from "../../lib/instance.js";
import { resolveBackupFile } from "../backups/engine/files.js";
import { locate, localRoots, type LocalRoot } from "./artifacts.service.js";
import * as repo from "./scans.repository.js";
import type { NewFinding, RegisteredFile } from "./scans.repository.js";

/** Tope de hallazgos guardados por escaneo: más allá el resultado es parcial. */
const MAX_FINDINGS = 10_000;
/** Profundidad máxima de carpetas bajo un destino (los backups usan 2-3 niveles). */
const MAX_DEPTH = 12;
/** Un escaneo `running` más viejo que esto se da por interrumpido. */
const STALE_MINUTES = 60;
/** stat en paralelo al comprobar los registrados. */
const STAT_CONCURRENCY = 32;

export interface ReconcileInput {
  roots: LocalRoot[];
  registered: RegisteredFile[];
  host: string;
  now: Date;
  graceMs: number;
  maxFiles: number;
  maxFindings?: number;
}

export interface ReconcileResult {
  findings: NewFinding[];
  filesScanned: number;
  truncated: boolean;
  detail: { scanned: number; missing: string[] };
}

const rootLabel = (r: LocalRoot) => r.name ?? "BACKUP_DIR";

/** Quita los destinos contenidos en otro (se recorrerían dos veces). */
function topLevelRoots(roots: LocalRoot[]): LocalRoot[] {
  const sorted = [...roots].sort((a, b) => a.abs.length - b.abs.length);
  const out: LocalRoot[] = [];
  for (const r of sorted) {
    const inside = out.some((o) => {
      const rel = path.relative(o.abs, r.abs);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    if (!inside) out.push(r);
  }
  return out;
}

/**
 * Compara el disco local de este host con el catálogo. Solo lee: nunca borra ni mueve.
 * - orphan/stale: recorre los destinos sin seguir symlinks (no sale del destino).
 * - missing: stat directo de cada registrado disponible de este host (no depende de
 *   que el recorrido haya terminado). Los heredados sin host se asumen de este host.
 */
export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
  const maxFindings = input.maxFindings ?? MAX_FINDINGS;
  const findings: NewFinding[] = [];
  let truncated = false;
  const push = (f: NewFinding) => {
    if (findings.length < maxFindings) findings.push(f);
    else truncated = true;
  };

  const byPath = new Map<string, RegisteredFile[]>();
  for (const reg of input.registered) {
    let abs: string;
    try {
      abs = resolveBackupFile(reg.fileName);
    } catch {
      continue;
    }
    const list = byPath.get(abs);
    if (list) list.push(reg);
    else byPath.set(abs, [reg]);
  }

  // Recorrido de los destinos existentes.
  const scannedRoots: LocalRoot[] = [];
  const missingRoots: string[] = [];
  for (const root of topLevelRoots(input.roots)) {
    const st = await stat(root.abs).catch(() => null);
    if (st?.isDirectory()) scannedRoots.push(root);
    else missingRoots.push(rootLabel(root));
  }

  let filesScanned = 0;
  const cutoff = input.now.getTime() - input.graceMs;
  walk: for (const root of scannedRoots) {
    const stack: { dir: string; depth: number }[] = [{ dir: root.abs, depth: 0 }];
    while (stack.length > 0) {
      const { dir, depth } = stack.pop()!;
      const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
        logger.warn({ err: (err as Error).message }, "Conciliación: carpeta ilegible, se omite");
        return [];
      });
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < MAX_DEPTH) stack.push({ dir: abs, depth: depth + 1 });
          continue;
        }
        if (!e.isFile()) continue;
        if (filesScanned >= input.maxFiles) {
          truncated = true;
          break walk;
        }
        filesScanned++;
        const st = await lstat(abs).catch(() => null);
        if (!st || st.mtimeMs > cutoff) continue;
        const regs = byPath.get(abs);
        if (regs && regs.some((r) => !r.pruned)) continue;
        push({
          kind: regs ? "stale" : "orphan",
          ...locate(abs, input.roots),
          fileBytes: st.size,
          modifiedAt: st.mtime,
          itemId: regs?.[0]?.itemId ?? null,
          executionId: regs?.[0]?.executionId ?? null,
        });
      }
    }
  }

  // Registrados disponibles de este host que ya no están en disco.
  const candidates = [...byPath.entries()].flatMap(([abs, regs]) =>
    regs.filter((r) => !r.pruned && (r.runnerHost === input.host || r.runnerHost == null)).map((r) => ({ abs, r })),
  );
  for (let i = 0; i < candidates.length; i += STAT_CONCURRENCY) {
    const chunk = candidates.slice(i, i + STAT_CONCURRENCY);
    const gone = await Promise.all(
      chunk.map(({ abs }) =>
        stat(abs).then(
          () => false,
          (err: NodeJS.ErrnoException) => err.code === "ENOENT" || err.code === "ENOTDIR",
        ),
      ),
    );
    chunk.forEach(({ abs, r }, k) => {
      if (gone[k]) {
        push({
          kind: "missing",
          ...locate(abs, input.roots),
          fileBytes: null,
          modifiedAt: null,
          itemId: r.itemId,
          executionId: r.executionId,
        });
      }
    });
  }

  return { findings, filesScanned, truncated, detail: { scanned: scannedRoots.length, missing: missingRoots } };
}

/**
 * Lanza el escaneo del disco de este host (el que atiende la petición). Responde al
 * registrarlo; el recorrido corre en segundo plano. Uno a la vez por host.
 */
export async function startScan(userId: string | null): Promise<StorageScanDto[]> {
  const id = await repo.insertScan(INSTANCE_HOST, userId, STALE_MINUTES);
  if (!id) throw HttpError.conflict("Ya hay un escaneo en curso en este host");
  void runScan(id);
  return repo.listLatestScans();
}

async function runScan(id: string): Promise<void> {
  try {
    const [roots, registered] = await Promise.all([localRoots(), repo.listRegisteredFiles()]);
    const res = await reconcile({
      roots,
      registered,
      host: INSTANCE_HOST,
      now: new Date(),
      graceMs: env.ARTIFACT_SCAN_GRACE_MINUTES * 60_000,
      maxFiles: env.ARTIFACT_SCAN_MAX_FILES,
    });
    await repo.insertFindings(id, res.findings);
    await repo.finishScan(id, INSTANCE_HOST, {
      status: "done",
      filesScanned: res.filesScanned,
      truncated: res.truncated,
      detail: res.detail,
      error: null,
    });
    logger.info({ scanId: id, files: res.filesScanned, findings: res.findings.length }, "Conciliación de archivos terminada");
  } catch (err) {
    logger.error({ err, scanId: id }, "Fallo en la conciliación de archivos");
    const msg = err instanceof Error ? err.message : String(err);
    await repo
      .finishScan(id, INSTANCE_HOST, { status: "failed", filesScanned: 0, truncated: false, detail: null, error: msg.slice(0, 500) })
      .catch(() => {});
  }
}

export const listLatestScans = repo.listLatestScans;
export const listFindings = repo.listFindings;
