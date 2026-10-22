-- Módulo "Archivos", paso 4: los objetos en bucket entran al catálogo y a la conciliación.

-- kind 'object': backup en bucket (gs://), incluidos el export de Cloud SQL y las
-- carpetas del dump paralelo (URI terminada en "/"). En buckets la app no purga
-- (ciclo de vida de GCS), así que pruned_at queda siempre NULL.
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
  WHERE i.status = 'success' AND i.local_file_name IS NOT NULL
  UNION ALL
  SELECT i.id, i.execution_id, 'object',
         i.file_name, i.pruned_at, i.file_bytes,
         i.file_sha256, i.file_md5, i.file_crc32c,
         i.db_name, i.finished_at, e.label, e.environment, e.runner_host, e.job_id
  FROM core.execution_items i
  JOIN core.executions e ON e.id = i.execution_id
  WHERE i.status = 'success' AND i.file_name LIKE 'gs://%';

-- Ámbito del escaneo: el host para el disco local (cada host tiene el suyo) o 'gcs'
-- para los buckets (compartidos: da igual qué instancia los liste).
ALTER TABLE core.storage_scans
  ADD COLUMN location text NOT NULL DEFAULT 'local' CHECK (location IN ('local', 'gcs')),
  ADD COLUMN scope text;
UPDATE core.storage_scans SET scope = runner_host;
ALTER TABLE core.storage_scans ALTER COLUMN scope SET NOT NULL;

DROP INDEX core.storage_scans_one_running;
CREATE UNIQUE INDEX storage_scans_one_running ON core.storage_scans (scope) WHERE status = 'running';
