-- Catálogo de archivos de backup en disco local (módulo "Archivos", etapa 1). Una fila
-- por archivo: el backup de un evento a disco (kind 'file') o la copia local conservada
-- de un backup subido a bucket (kind 'copy'). Los objetos gs:// quedan para la etapa 2.
-- Solo ítems correctos: un dump fallido no deja archivo útil.
-- Sin índice nuevo: execution_items crece decenas de filas por día y el listado es
-- paginado; el filtro principal (status = 'success') no es selectivo.
CREATE VIEW core.backup_artifacts AS
  SELECT i.id AS item_id, i.execution_id, 'file'::text AS kind,
         i.file_name, i.pruned_at, i.file_bytes,
         i.file_sha256, i.file_md5, i.file_crc32c,
         i.db_name, i.finished_at, e.label, e.environment, e.runner_host, e.job_id
  FROM core.execution_items i
  JOIN core.executions e ON e.id = i.execution_id
  WHERE i.status = 'success' AND i.file_name IS NOT NULL AND i.file_name NOT LIKE 'gs://%'
  UNION ALL
  -- La copia es el mismo dump que se subió: comparte tamaño y sha256 (md5/crc32c son del objeto).
  SELECT i.id, i.execution_id, 'copy',
         i.local_file_name, i.local_pruned_at, i.file_bytes,
         i.file_sha256, NULL, NULL,
         i.db_name, i.finished_at, e.label, e.environment, e.runner_host, e.job_id
  FROM core.execution_items i
  JOIN core.executions e ON e.id = i.execution_id
  WHERE i.status = 'success' AND i.local_file_name IS NOT NULL;
