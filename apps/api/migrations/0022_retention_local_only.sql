-- Etapa 4 (parte 24): la retención solo aplica al almacenamiento local. En los métodos
-- a bucket (gcloud, cloudsql_export) la app no borra objetos; la limpieza se gestiona
-- con el ciclo de vida del bucket en GCS. Se quita la regla de los eventos que la tenían.
UPDATE core.backup_jobs
SET options = options - 'retention'
WHERE method <> 'dump' AND options ? 'retention';
