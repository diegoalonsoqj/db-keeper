import type { ScanFindingDto, ScanFindingKind, StorageScanDto, StorageScanStatus } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";
import { isUniqueViolation } from "../../lib/pg-error.js";
import { SqlWhere } from "../../lib/list-query.js";

/** Archivo registrado en el catálogo, tal como se guardó (lo normaliza el servicio). */
export interface RegisteredFile {
  itemId: string;
  executionId: string;
  fileName: string;
  pruned: boolean;
  runnerHost: string | null;
}

export async function listRegisteredFiles(): Promise<RegisteredFile[]> {
  const { rows } = await query<{
    item_id: string;
    execution_id: string;
    file_name: string;
    pruned: boolean;
    runner_host: string | null;
  }>("SELECT item_id, execution_id, file_name, pruned_at IS NOT NULL AS pruned, runner_host FROM core.backup_artifacts");
  return rows.map((r) => ({
    itemId: r.item_id,
    executionId: r.execution_id,
    fileName: r.file_name,
    pruned: r.pruned,
    runnerHost: r.runner_host,
  }));
}

/**
 * Registra un escaneo `running` para el host. Antes libera los de ese host que quedaron
 * colgados (el proceso se reinició a mitad). Devuelve null si ya hay uno en curso.
 */
export async function insertScan(host: string, userId: string | null, staleMinutes: number): Promise<string | null> {
  await query(
    `UPDATE core.storage_scans SET status = 'failed', finished_at = now(), error = 'Interrumpido'
     WHERE runner_host = $1 AND status = 'running' AND started_at < now() - make_interval(mins => $2::int)`,
    [host, staleMinutes],
  );
  try {
    const { rows } = await query<{ id: string }>(
      "INSERT INTO core.storage_scans (runner_host, started_by) VALUES ($1, $2) RETURNING id",
      [host, userId],
    );
    return rows[0]!.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export interface NewFinding {
  kind: ScanFindingKind;
  storageName: string | null;
  relativePath: string;
  fileBytes: number | null;
  modifiedAt: Date | null;
  itemId: string | null;
  executionId: string | null;
}

/** Inserta los hallazgos en un solo INSERT (el llamador ya aplicó el tope). */
export async function insertFindings(scanId: string, findings: NewFinding[]): Promise<void> {
  if (findings.length === 0) return;
  await query(
    `INSERT INTO core.storage_scan_findings
       (scan_id, kind, storage_name, relative_path, file_bytes, modified_at, item_id, execution_id)
     SELECT $1, f.kind, f.storage_name, f.relative_path, f.file_bytes, f.modified_at, f.item_id, f.execution_id
     FROM json_to_recordset($2::json) AS f(kind text, storage_name text, relative_path text, file_bytes bigint,
       modified_at timestamptz, item_id uuid, execution_id uuid)`,
    [
      scanId,
      JSON.stringify(
        findings.map((f) => ({
          kind: f.kind,
          storage_name: f.storageName,
          relative_path: f.relativePath,
          file_bytes: f.fileBytes,
          modified_at: f.modifiedAt?.toISOString() ?? null,
          item_id: f.itemId,
          execution_id: f.executionId,
        })),
      ),
    ],
  );
}

/**
 * Cierra el escaneo y limpia los anteriores del host: si terminó bien, reemplaza a todos;
 * si falló, se conserva el último correcto (sus hallazgos siguen siendo la referencia).
 */
export async function finishScan(
  id: string,
  host: string,
  r: { status: Exclude<StorageScanStatus, "running">; filesScanned: number; truncated: boolean; detail: unknown; error: string | null },
): Promise<void> {
  await query(
    `UPDATE core.storage_scans
     SET status = $2, finished_at = now(), files_scanned = $3, truncated = $4, detail = $5, error = $6
     WHERE id = $1`,
    [id, r.status, r.filesScanned, r.truncated, r.detail == null ? null : JSON.stringify(r.detail), r.error],
  );
  await query(
    `DELETE FROM core.storage_scans
     WHERE runner_host = $1 AND id <> $2 AND status <> 'running' AND ($3 = 'done' OR status = 'failed')`,
    [host, id, r.status],
  );
}

interface ScanRow {
  id: string;
  runner_host: string;
  status: StorageScanStatus;
  started_by: string | null;
  started_at: Date;
  finished_at: Date | null;
  files_scanned: number;
  truncated: boolean;
  detail: { scanned: number; missing: string[] } | null;
  error: string | null;
  counts: Record<ScanFindingKind, number> | null;
}

/** Escaneo más reciente de cada host (en curso, correcto o fallido), con sus conteos. */
export async function listLatestScans(): Promise<StorageScanDto[]> {
  const { rows } = await query<ScanRow>(
    `SELECT s.id, s.runner_host, s.status, u.username AS started_by, s.started_at, s.finished_at,
       s.files_scanned, s.truncated, s.detail, s.error,
       (SELECT json_build_object(
          'orphan', count(*) FILTER (WHERE f.kind = 'orphan'),
          'missing', count(*) FILTER (WHERE f.kind = 'missing'),
          'stale', count(*) FILTER (WHERE f.kind = 'stale'))
        FROM core.storage_scan_findings f WHERE f.scan_id = s.id) AS counts
     FROM (SELECT DISTINCT ON (runner_host) * FROM core.storage_scans ORDER BY runner_host, started_at DESC) s
     LEFT JOIN auth.users u ON u.id = s.started_by
     ORDER BY s.runner_host`,
  );
  return rows.map((r) => ({
    id: r.id,
    runnerHost: r.runner_host,
    status: r.status,
    startedBy: r.started_by,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    filesScanned: r.files_scanned,
    truncated: r.truncated,
    roots: r.detail,
    counts: r.counts ?? { orphan: 0, missing: 0, stale: 0 },
    error: r.error,
  }));
}

export interface FindingListQuery {
  limit: number;
  offset: number;
  q?: string;
  kind?: ScanFindingKind;
  runnerHost?: string;
}

/** Hallazgos del último escaneo correcto de cada host. */
export async function listFindings(p: FindingListQuery): Promise<{ items: ScanFindingDto[]; total: number }> {
  const w = new SqlWhere().eq("f.kind", p.kind).eq("s.runner_host", p.runnerHost).search(["f.relative_path"], p.q);
  const from = `
    FROM core.storage_scan_findings f
    JOIN (SELECT DISTINCT ON (runner_host) id, runner_host FROM core.storage_scans
          WHERE status = 'done' ORDER BY runner_host, started_at DESC) s ON s.id = f.scan_id`;
  const totalRes = await query<{ count: string }>(`SELECT count(*)::text AS count ${from} ${w.sql}`, w.params);
  const n = w.params.length;
  const { rows } = await query<{
    id: string;
    runner_host: string;
    kind: ScanFindingKind;
    storage_name: string | null;
    relative_path: string;
    file_bytes: string | null;
    modified_at: Date | null;
    item_id: string | null;
    execution_id: string | null;
  }>(
    `SELECT f.id::text, s.runner_host, f.kind, f.storage_name, f.relative_path, f.file_bytes::text,
            f.modified_at, f.item_id, f.execution_id
     ${from} ${w.sql}
     ORDER BY f.kind, s.runner_host, f.storage_name NULLS LAST, f.relative_path, f.id
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, p.limit, p.offset],
  );
  return {
    total: Number(totalRes.rows[0]?.count ?? 0),
    items: rows.map((r) => ({
      id: Number(r.id),
      runnerHost: r.runner_host,
      kind: r.kind,
      storageName: r.storage_name,
      relativePath: r.relative_path,
      fileBytes: r.file_bytes == null ? null : Number(r.file_bytes),
      modifiedAt: r.modified_at?.toISOString() ?? null,
      itemId: r.item_id,
      executionId: r.execution_id,
    })),
  };
}
