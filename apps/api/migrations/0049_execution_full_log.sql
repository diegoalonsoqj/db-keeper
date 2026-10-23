-- Log completo de cada BD como archivo junto al backup (evidencia de auditoría).
-- execution_items.log conserva el resumen (principio y final) para la consola web;
-- el archivo tiene todas las líneas con su hora y su propio SHA-256.
ALTER TABLE core.execution_items
  ADD COLUMN log_file text,
  ADD COLUMN log_bytes bigint,
  ADD COLUMN log_sha256 text;

-- kind 'log': el archivo de log (ruta local o gs://). Existe también para las BD que
-- fallaron. Un log local se purga junto con su dump (mismo pruned_at); en buckets la
-- app no purga.
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
  WHERE i.status = 'success' AND i.file_name LIKE 'gs://%'
  UNION ALL
  SELECT i.id, i.execution_id, 'log',
         i.log_file, CASE WHEN i.log_file NOT LIKE 'gs://%' THEN i.pruned_at END, i.log_bytes,
         i.log_sha256, NULL, NULL,
         i.db_name, i.finished_at, e.label, e.environment, e.runner_host, e.job_id
  FROM core.execution_items i
  JOIN core.executions e ON e.id = i.execution_id
  WHERE i.log_file IS NOT NULL;
