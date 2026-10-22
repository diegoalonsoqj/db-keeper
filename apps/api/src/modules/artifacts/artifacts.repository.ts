import type { ArtifactKind, ArtifactLocation, ArtifactSort, ArtifactState, DbEngine, FileChecksums, SortDir } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";
import { orderBy, SqlWhere } from "../../lib/list-query.js";

export interface ArtifactListQuery {
  limit: number;
  offset: number;
  /** Nombre del evento o de la BD. */
  q?: string;
  kind?: ArtifactKind;
  location?: ArtifactLocation;
  state?: ArtifactState;
  environment?: string;
  engine?: DbEngine;
  runnerHost?: string;
  /** Rango sobre el fin del ítem, igual que en Ejecuciones (`to` inclusivo). */
  from?: Date;
  to?: Date;
  sort?: ArtifactSort;
  dir?: SortDir;
}

/** Fila del catálogo con la ruta absoluta tal como se guardó (la traduce el servicio). */
export interface ArtifactRecord {
  itemId: string;
  executionId: string;
  kind: ArtifactKind;
  fileName: string;
  label: string;
  environment: string | null;
  engine: DbEngine | null;
  serverName: string | null;
  dbName: string;
  fileBytes: number | null;
  runnerHost: string | null;
  finishedAt: string | null;
  prunedAt: string | null;
  checksums: FileChecksums | null;
}

interface ArtifactRow {
  item_id: string;
  execution_id: string;
  kind: ArtifactKind;
  file_name: string;
  label: string;
  environment: string | null;
  engine: DbEngine | null;
  server_name: string | null;
  db_name: string;
  file_bytes: string | null;
  runner_host: string | null;
  finished_at: Date | null;
  pruned_at: Date | null;
  file_sha256: string | null;
  file_md5: string | null;
  file_crc32c: string | null;
}

function toRecord(r: ArtifactRow): ArtifactRecord {
  const hasChecksum = r.file_sha256 ?? r.file_md5 ?? r.file_crc32c;
  return {
    itemId: r.item_id,
    executionId: r.execution_id,
    kind: r.kind,
    fileName: r.file_name,
    label: r.label,
    environment: r.environment,
    engine: r.engine,
    serverName: r.server_name,
    dbName: r.db_name,
    fileBytes: r.file_bytes == null ? null : Number(r.file_bytes),
    runnerHost: r.runner_host,
    finishedAt: r.finished_at?.toISOString() ?? null,
    prunedAt: r.pruned_at?.toISOString() ?? null,
    checksums: hasChecksum ? { sha256: r.file_sha256, md5: r.file_md5, crc32c: r.file_crc32c } : null,
  };
}

// El evento y la instancia pueden haberse borrado: el archivo se lista igual.
const FROM = `
  FROM core.backup_artifacts a
  LEFT JOIN core.backup_jobs j ON j.id = a.job_id
  LEFT JOIN core.servers s ON s.id = j.server_id
`;

const ARTIFACT_ORDER: Record<ArtifactSort, string> = {
  finished: "a.finished_at",
  label: "lower(a.label)",
  database: "lower(a.db_name)",
  environment: "a.environment",
  size: "a.file_bytes",
};

export async function listArtifacts(p: ArtifactListQuery): Promise<{ items: ArtifactRecord[]; total: number }> {
  const w = new SqlWhere()
    .eq("a.kind", p.kind)
    .eq("a.environment", p.environment)
    .eq("s.engine", p.engine)
    .eq("a.runner_host", p.runnerHost)
    .search(["a.label", "a.db_name"], p.q);
  if (p.location) w.add(`a.kind ${p.location === "gcs" ? "=" : "<>"} 'object'`);
  if (p.state) w.add(p.state === "pruned" ? "a.pruned_at IS NOT NULL" : "a.pruned_at IS NULL");
  if (p.from) w.add(`a.finished_at >= ${w.param(p.from)}`);
  if (p.to) w.add(`a.finished_at < ${w.param(p.to)}::timestamptz + interval '1 day'`);

  const totalRes = await query<{ count: string }>(`SELECT count(*)::text AS count ${FROM} ${w.sql}`, w.params);
  const total = Number(totalRes.rows[0]?.count ?? 0);
  // item_id no basta como desempate: un ítem puede tener archivo y copia.
  const order = orderBy(ARTIFACT_ORDER, p.sort, p.dir, { sort: "finished", dir: "desc" }, "a.item_id, a.kind");
  const n = w.params.length;
  const { rows } = await query<ArtifactRow>(
    `SELECT a.item_id, a.execution_id, a.kind, a.file_name, a.label, a.environment, s.engine,
            s.name AS server_name, a.db_name, a.file_bytes::text, a.runner_host, a.finished_at,
            a.pruned_at, a.file_sha256, a.file_md5, a.file_crc32c
     ${FROM} ${w.sql} ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...w.params, p.limit, p.offset],
  );
  return { items: rows.map(toRecord), total };
}

/** Hosts que generaron archivos locales (opciones del filtro). */
export async function listRunnerHosts(): Promise<string[]> {
  const { rows } = await query<{ runner_host: string }>(
    "SELECT DISTINCT runner_host FROM core.backup_artifacts WHERE runner_host IS NOT NULL ORDER BY runner_host",
  );
  return rows.map((r) => r.runner_host);
}
