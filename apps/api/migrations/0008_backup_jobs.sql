-- Etapa 4 (parte 1): eventos de backup multi-BD y registro de ejecuciones.
-- Un "evento de backup" (core.backup_jobs) es la definición reutilizable: una
-- instancia, su credencial (heredada o override), las BDs a respaldar, el método
-- y el destino. Cada corrida crea una ejecución (core.executions) con un ítem por
-- BD (core.execution_items). El motor real y el scheduler llegan en fases siguientes.

CREATE TABLE core.backup_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  server_id     uuid NOT NULL REFERENCES core.servers(id) ON DELETE CASCADE,
  -- Credencial override; NULL = usar la de la instancia.
  credential_id uuid REFERENCES secrets.credentials(id) ON DELETE SET NULL,
  method        text NOT NULL CHECK (method IN ('dump', 'gcloud')),
  -- Destino: bucket de GCS (obligatorio para gcloud; opcional para dump local).
  bucket_id     uuid REFERENCES core.storage_buckets(id) ON DELETE SET NULL,
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backup_jobs_server_idx ON core.backup_jobs (server_id);
CREATE TRIGGER backup_jobs_set_updated_at BEFORE UPDATE ON core.backup_jobs
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- BDs seleccionadas del evento (multi-BD).
CREATE TABLE core.backup_job_databases (
  job_id   uuid NOT NULL REFERENCES core.backup_jobs(id) ON DELETE CASCADE,
  db_name  text NOT NULL,
  PRIMARY KEY (job_id, db_name)
);

-- Cabecera de cada corrida (el "identificador del evento de generación").
CREATE TABLE core.executions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Se conserva el historial aunque se borre el evento (job_id queda NULL).
  job_id       uuid REFERENCES core.backup_jobs(id) ON DELETE SET NULL,
  label        text NOT NULL,                 -- nombre del evento al momento (snapshot)
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'success', 'failed')),
  origin       text NOT NULL DEFAULT 'manual'
                 CHECK (origin IN ('manual', 'scheduled')),
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executions_job_idx ON core.executions (job_id);
CREATE INDEX executions_created_idx ON core.executions (created_at DESC);

-- Detalle por BD dentro de una ejecución.
CREATE TABLE core.execution_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id  uuid NOT NULL REFERENCES core.executions(id) ON DELETE CASCADE,
  db_name       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'success', 'failed')),
  file_name     text,
  file_bytes    bigint,
  log           text,
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX execution_items_execution_idx ON core.execution_items (execution_id);
