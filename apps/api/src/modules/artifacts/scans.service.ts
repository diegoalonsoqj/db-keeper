import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ArtifactLocation, StorageScanDto } from "@dbkeeper/shared";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../lib/http-error.js";
import { INSTANCE_HOST } from "../../lib/instance.js";
import { resolveBackupFile } from "../backups/engine/files.js";
import { listGcsObjectsPage, parseGcsUri, type GcsListedObject } from "../backups/engine/gcs.js";
import { getServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
import * as storageRepo from "../storage/storage.repository.js";
import type { BucketRoot } from "../storage/storage.repository.js";
import { locate, locateObject, localRoots, normalizePrefix, type LocalRoot } from "./artifacts.service.js";
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
  // Lo que vive en un bucket (objetos y logs subidos) no está en este disco.
  for (const reg of input.registered.filter((r) => !r.fileName.startsWith("gs://"))) {
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

export interface BucketTarget extends BucketRoot {
  serviceAccountJson: string | null;
}

/** Lista una página de objetos de un destino (inyectable para pruebas). */
export type ObjectPageLister = (
  target: BucketTarget,
  prefix: string,
  pageToken?: string,
) => Promise<{ objects: GcsListedObject[]; nextPageToken?: string }>;

export interface ReconcileGcsInput {
  targets: BucketTarget[];
  registered: RegisteredFile[];
  now: Date;
  graceMs: number;
  maxObjects: number;
  maxFindings?: number;
  listPage: ObjectPageLister;
}

/** Quita los destinos cuyo prefijo cae dentro de otro del mismo bucket (se listarían dos veces). */
function topLevelTargets(targets: BucketTarget[]): BucketTarget[] {
  const sorted = [...targets].sort((a, b) => normalizePrefix(a.prefix).length - normalizePrefix(b.prefix).length);
  const out: BucketTarget[] = [];
  for (const t of sorted) {
    const p = normalizePrefix(t.prefix);
    const inside = out.some((o) => {
      if (o.bucket !== t.bucket) return false;
      const op = normalizePrefix(o.prefix);
      return op === "" || p === op || p.startsWith(`${op}/`);
    });
    if (!inside) out.push(t);
  }
  return out;
}

/** ¿El objeto cae bajo el prefijo del destino? */
function underTarget(t: BucketTarget, bucket: string, object: string): boolean {
  const p = normalizePrefix(t.prefix);
  return t.bucket === bucket && (p === "" || object.startsWith(`${p}/`));
}

/**
 * Compara los buckets de los destinos con el catálogo. Solo lista (lectura): nunca
 * borra objetos. Una carpeta del dump paralelo (URI terminada en "/") cubre todos los
 * objetos bajo ella. Los faltantes solo se informan en destinos listados completos: con
 * un listado cortado no se puede afirmar que un objeto no exista.
 */
export async function reconcileGcs(input: ReconcileGcsInput): Promise<ReconcileResult> {
  const maxFindings = input.maxFindings ?? MAX_FINDINGS;
  const findings: NewFinding[] = [];
  let truncated = false;
  const push = (f: NewFinding) => {
    if (findings.length < maxFindings) findings.push(f);
    else truncated = true;
  };

  // Registrados por bucket: objetos exactos y carpetas ("a/b/c/").
  const exact = new Map<string, Map<string, RegisteredFile>>();
  const dirs = new Map<string, Map<string, RegisteredFile>>();
  for (const reg of input.registered) {
    if (!reg.fileName.startsWith("gs://")) continue;
    const parsed = parseGcsUri(reg.fileName);
    if (!parsed) continue;
    const bag = parsed.object.endsWith("/") ? dirs : exact;
    let m = bag.get(parsed.bucket);
    if (!m) bag.set(parsed.bucket, (m = new Map()));
    m.set(parsed.object, reg);
  }

  const seen = new Set<string>();
  const complete: BucketTarget[] = [];
  const inaccessible: string[] = [];
  let scanned = 0;
  let objectsListed = 0;
  const cutoff = input.now.getTime() - input.graceMs;

  for (const target of topLevelTargets(input.targets)) {
    const prefix = normalizePrefix(target.prefix);
    const exactHere = exact.get(target.bucket);
    const dirsHere = dirs.get(target.bucket);
    let pageToken: string | undefined;
    let listedAll = false;
    try {
      do {
        if (objectsListed >= input.maxObjects) {
          truncated = true;
          break;
        }
        const page = await input.listPage(target, prefix ? `${prefix}/` : "", pageToken);
        for (const o of page.objects) {
          objectsListed++;
          if (exactHere?.has(o.name)) {
            seen.add(`${target.bucket}/${o.name}`);
            continue;
          }
          // ¿Pertenece a una carpeta registrada? Se prueba cada carpeta ancestra.
          let dir: string | null = null;
          for (let i = o.name.indexOf("/"); i !== -1 && !dir; i = o.name.indexOf("/", i + 1)) {
            const candidate = o.name.slice(0, i + 1);
            if (dirsHere?.has(candidate)) dir = candidate;
          }
          if (dir) {
            seen.add(`${target.bucket}/${dir}`);
            continue;
          }
          // Recientes: pueden ser subidas o exports en curso.
          if (o.updated && o.updated.getTime() > cutoff) continue;
          push({
            kind: "orphan",
            ...locateObject(`gs://${target.bucket}/${o.name}`, input.targets),
            fileBytes: o.bytes,
            modifiedAt: o.updated,
            itemId: null,
            executionId: null,
          });
        }
        pageToken = page.nextPageToken;
        listedAll = !pageToken;
      } while (pageToken);
      scanned++;
    } catch (err) {
      logger.warn({ err: (err as Error).message, target: target.name }, "Conciliación: no se pudo listar el bucket");
      inaccessible.push(target.name);
      continue;
    }
    if (listedAll) complete.push(target);
  }

  // Faltantes: registrados bajo un destino listado completo que no aparecieron.
  for (const bag of [exact, dirs]) {
    for (const [bucket, objs] of bag) {
      for (const [object, reg] of objs) {
        if (seen.has(`${bucket}/${object}`)) continue;
        if (!complete.some((t) => underTarget(t, bucket, object))) continue;
        push({
          kind: "missing",
          ...locateObject(`gs://${bucket}/${object}`, input.targets),
          fileBytes: null,
          modifiedAt: null,
          itemId: reg.itemId,
          executionId: reg.executionId,
        });
      }
    }
  }

  return { findings, filesScanned: objectsListed, truncated, detail: { scanned, missing: inaccessible } };
}

/** Destinos bucket activos con su credencial; los que no la pueden resolver van como inaccesibles. */
async function bucketTargets(): Promise<{ targets: BucketTarget[]; failed: string[] }> {
  const roots = (await storageRepo.listBucketRoots()).filter((b) => b.isActive);
  const targets: BucketTarget[] = [];
  const failed: string[] = [];
  for (const b of roots) {
    try {
      const sa = b.cloudCredentialId ? await getServiceAccountJson(b.cloudCredentialId) : null;
      targets.push({ ...b, serviceAccountJson: sa });
    } catch (err) {
      logger.warn({ err: (err as Error).message, target: b.name }, "Conciliación: credencial del bucket no disponible");
      failed.push(b.name);
    }
  }
  return { targets, failed };
}

const listPage: ObjectPageLister = (t, prefix, pageToken) =>
  listGcsObjectsPage({ bucket: t.bucket, serviceAccountJson: t.serviceAccountJson }, prefix, pageToken);

/**
 * Lanza un escaneo: `local` recorre el disco de este host (el que atiende la petición);
 * `gcs` lista los buckets de los destinos (compartidos: uno a la vez en total). Responde
 * al registrarlo; el trabajo corre en segundo plano.
 */
export async function startScan(location: ArtifactLocation, userId: string | null): Promise<StorageScanDto[]> {
  const scope = location === "gcs" ? "gcs" : INSTANCE_HOST;
  const id = await repo.insertScan({ location, scope, host: INSTANCE_HOST, userId }, STALE_MINUTES);
  if (!id) {
    throw HttpError.conflict(location === "gcs" ? "Ya hay un escaneo de buckets en curso" : "Ya hay un escaneo en curso en este host");
  }
  void runScan(id, location, scope);
  return repo.listLatestScans();
}

async function runScan(id: string, location: ArtifactLocation, scope: string): Promise<void> {
  try {
    const registered = await repo.listRegisteredFiles();
    const now = new Date();
    const graceMs = env.ARTIFACT_SCAN_GRACE_MINUTES * 60_000;
    let res: ReconcileResult;
    if (location === "gcs") {
      const { targets, failed } = await bucketTargets();
      res = await reconcileGcs({ targets, registered, now, graceMs, maxObjects: env.ARTIFACT_SCAN_MAX_OBJECTS, listPage });
      res.detail.missing.push(...failed);
    } else {
      res = await reconcile({ roots: await localRoots(), registered, host: INSTANCE_HOST, now, graceMs, maxFiles: env.ARTIFACT_SCAN_MAX_FILES });
    }
    await repo.insertFindings(id, res.findings);
    await repo.finishScan(id, scope, {
      status: "done",
      filesScanned: res.filesScanned,
      truncated: res.truncated,
      detail: res.detail,
      error: null,
    });
    logger.info({ scanId: id, location, files: res.filesScanned, findings: res.findings.length }, "Conciliación de archivos terminada");
  } catch (err) {
    logger.error({ err, scanId: id, location }, "Fallo en la conciliación de archivos");
    const msg = err instanceof Error ? err.message : String(err);
    await repo
      .finishScan(id, scope, { status: "failed", filesScanned: 0, truncated: false, detail: null, error: msg.slice(0, 500) })
      .catch(() => {});
  }
}

export const listLatestScans = repo.listLatestScans;
export const listFindings = repo.listFindings;
