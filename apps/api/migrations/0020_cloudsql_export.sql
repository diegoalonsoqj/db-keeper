-- Etapa 4 (parte 22): export de Cloud SQL. Nuevo método `cloudsql_export`: la propia
-- instancia gestionada genera el respaldo (SQL Server → .bak) y lo deja en un bucket
-- GCS vía la API de Cloud SQL Admin; DBKeeper no se conecta a la BD.
ALTER TABLE core.backup_jobs DROP CONSTRAINT backup_jobs_method_check;
ALTER TABLE core.backup_jobs ADD CONSTRAINT backup_jobs_method_check
  CHECK (method IN ('dump', 'gcloud', 'cloudsql_export'));

-- Credencial de nube (service account GCP) con la que se llama a la API de Cloud SQL
-- de la instancia. NULL = credencial GCP por defecto del catálogo o, si no hay, ADC.
ALTER TABLE core.servers
  ADD COLUMN cloud_credential_id uuid REFERENCES secrets.cloud_credentials(id) ON DELETE SET NULL;
