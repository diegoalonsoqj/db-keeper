import path from "node:path";
import type { BackupArtifactDto } from "@dbkeeper/shared";
import * as repo from "./artifacts.repository.js";
import * as storageRepo from "../storage/storage.repository.js";
import { BACKUP_ROOT, resolveBackupFile } from "../backups/engine/files.js";
import { parseGcsUri } from "../backups/engine/gcs.js";
import type { BucketRoot } from "../storage/storage.repository.js";

export interface LocalRoot {
  name: string | null;
  /** Ruta absoluta del directorio. */
  abs: string;
}

/**
 * Ubica un archivo en el destino local más específico que lo contiene y devuelve su
 * ruta relativa. Fuera de todo destino solo se expone el nombre: la ruta absoluta
 * revela la estructura del host.
 */
export function locate(stored: string, roots: LocalRoot[]): { storageName: string | null; relativePath: string } {
  let abs: string;
  try {
    abs = resolveBackupFile(stored);
  } catch {
    return { storageName: null, relativePath: path.basename(stored) };
  }
  let best: { root: LocalRoot; rel: string } | null = null;
  for (const root of roots) {
    const rel = path.relative(root.abs, abs);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (!best || root.abs.length > best.root.abs.length) best = { root, rel };
  }
  return best
    ? { storageName: best.root.name, relativePath: best.rel.split(path.sep).join("/") }
    : { storageName: null, relativePath: path.basename(abs) };
}

/**
 * Destinos locales actuales + BACKUP_DIR (raíz de los registros heredados), resueltos
 * como el runner. BACKUP_DIR va al final: ante la misma ruta gana el destino con nombre.
 */
export async function localRoots(): Promise<LocalRoot[]> {
  const targets = await storageRepo.listLocalRoots();
  return [
    ...targets.map((t) => ({ name: t.name, abs: path.resolve(process.cwd(), t.path.trim()) })),
    { name: null, abs: BACKUP_ROOT },
  ];
}

/** Prefijo de un destino bucket normalizado ("a/b", sin barras extremas; "" = raíz). */
export function normalizePrefix(prefix: string | null): string {
  return (prefix ?? "").replace(/^\/+|\/+$/g, "");
}

/** Nombre final de un objeto, conservando la "/" de las carpetas. */
function objectBaseName(object: string): string {
  const isDir = object.endsWith("/");
  const base = path.posix.basename(object);
  return isDir ? `${base}/` : base;
}

/**
 * Ubica un objeto `gs://` en el destino bucket de prefijo más específico y devuelve la
 * ruta relativa a ese prefijo. Nunca expone el nombre del bucket: sin destino que lo
 * contenga, solo el nombre del objeto.
 */
export function locateObject(uri: string, buckets: BucketRoot[]): { storageName: string | null; relativePath: string } {
  const parsed = parseGcsUri(uri);
  if (!parsed) return { storageName: null, relativePath: objectBaseName(uri) };
  let best: { name: string; prefix: string } | null = null;
  for (const b of buckets) {
    if (b.bucket !== parsed.bucket) continue;
    const prefix = normalizePrefix(b.prefix);
    if (prefix && !parsed.object.startsWith(`${prefix}/`)) continue;
    if (!best || prefix.length > best.prefix.length) best = { name: b.name, prefix };
  }
  if (!best) return { storageName: null, relativePath: objectBaseName(parsed.object) };
  return { storageName: best.name, relativePath: best.prefix ? parsed.object.slice(best.prefix.length + 1) : parsed.object };
}

export async function listArtifacts(p: repo.ArtifactListQuery): Promise<{ items: BackupArtifactDto[]; total: number }> {
  const [page, roots, buckets] = await Promise.all([repo.listArtifacts(p), localRoots(), storageRepo.listBucketRoots()]);
  const items = page.items.map(({ fileName, ...r }) => ({
    ...r,
    ...(fileName.startsWith("gs://") ? locateObject(fileName, buckets) : locate(fileName, roots)),
  }));
  return { items, total: page.total };
}

export function listRunnerHosts(): Promise<string[]> {
  return repo.listRunnerHosts();
}
