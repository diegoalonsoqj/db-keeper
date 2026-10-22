import path from "node:path";
import type { BackupArtifactDto } from "@dbkeeper/shared";
import * as repo from "./artifacts.repository.js";
import * as storageRepo from "../storage/storage.repository.js";
import { BACKUP_ROOT, resolveBackupFile } from "../backups/engine/files.js";

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
async function localRoots(): Promise<LocalRoot[]> {
  const targets = await storageRepo.listLocalRoots();
  return [
    ...targets.map((t) => ({ name: t.name, abs: path.resolve(process.cwd(), t.path.trim()) })),
    { name: null, abs: BACKUP_ROOT },
  ];
}

export async function listArtifacts(p: repo.ArtifactListQuery): Promise<{ items: BackupArtifactDto[]; total: number }> {
  const [page, roots] = await Promise.all([repo.listArtifacts(p), localRoots()]);
  const items = page.items.map(({ fileName, ...r }) => ({ ...r, ...locate(fileName, roots) }));
  return { items, total: page.total };
}

export function listRunnerHosts(): Promise<string[]> {
  return repo.listRunnerHosts();
}
