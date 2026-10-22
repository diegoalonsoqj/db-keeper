-- Conciliación del catálogo de archivos con el disco local (módulo "Archivos", paso 3).

-- SQL Server escribe el .bak en el propio servidor de la instancia: su file_name es una
-- ruta de ese host, no del disco de DBKeeper. Se filtra por extensión (solo SQL Server
-- genera .bak en disco; el export de Cloud SQL va a gs://) para que funcione aunque el
-- evento se haya borrado.
CREATE OR REPLACE VIEW core.backup_artifacts AS
  SELECT i.id AS item_id, i.execution_id, 'file'::text AS kind,
         i.file_name, i.pruned_at, i.file_bytes,
         i.file_sha256, i.file_md5, i.file_crc32c,
         i.db_name, i.finished_at, e.label, e.environment, e.runner_host, e.job_id
  FROM core.execution_items i
  JOIN core.executions e ON e.id = i.execution_id
  WHERE i.status = 'success' AND i.file_name IS NOT NULL AND i.file_name NOT LIKE 'gs://%'
    AND i.file_name NOT ILIKE '%.bak'
  UNION ALL
  SELECT i.id, i.execution_id, 'copy',
         i.local_file_name, i.local_pruned_at, i.file_bytes,
         i.file_sha256, NULL, NULL,
         i.db_name, i.finished_at, e.label, e.environment, e.runner_host, e.job_id
  FROM core.execution_items i
  JOIN core.executions e ON e.id = i.execution_id
  WHERE i.status = 'success' AND i.local_file_name IS NOT NULL;

-- Un escaneo por host (el disco es local a cada host). Solo se conserva el último
-- terminado de cada host; los hallazgos se borran con él.
CREATE TABLE core.storage_scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_host   text NOT NULL,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  started_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  files_scanned integer NOT NULL DEFAULT 0,
  -- Se cortó por el tope de archivos o de hallazgos: el resultado es parcial.
  truncated     boolean NOT NULL DEFAULT false,
  -- Resumen: destinos recorridos y los que no existen en este host (por nombre, sin rutas).
  detail        jsonb,
  error         text
);
-- A lo sumo un escaneo en curso por host.
CREATE UNIQUE INDEX storage_scans_one_running ON core.storage_scans (runner_host) WHERE status = 'running';

-- orphan: archivo en disco sin registro. missing: registrado y disponible, pero no está
-- en disco. stale: registrado como purgado, pero sigue en disco.
CREATE TABLE core.storage_scan_findings (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scan_id       uuid NOT NULL REFERENCES core.storage_scans(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('orphan', 'missing', 'stale')),
  storage_name  text,
  relative_path text NOT NULL,
  file_bytes    bigint,
  modified_at   timestamptz,
  item_id       uuid,
  execution_id  uuid
);
-- El listado de hallazgos siempre filtra por escaneo (el último de cada host).
CREATE INDEX storage_scan_findings_scan_idx ON core.storage_scan_findings (scan_id, kind);
