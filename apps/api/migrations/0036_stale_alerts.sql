-- Vigilancia de frescura: avisa cuando un evento programado no tiene un backup correcto
-- tras su último disparo (el scheduler no corrió, la ejecución no se creó, quedó
-- atascada o falló). Tabla aparte (y no una columna en backup_jobs) para no tocar su
-- updated_at en cada aviso.
CREATE TABLE core.job_stale_alerts (
  job_id     uuid PRIMARY KEY REFERENCES core.backup_jobs(id) ON DELETE CASCADE,
  -- Disparo ya avisado: no se repite el aviso del mismo disparo.
  fire_at    timestamptz NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now()
);

-- "¿Hay un backup correcto de este evento desde el disparo X?"
CREATE INDEX executions_job_success_idx ON core.executions (job_id, created_at DESC)
  WHERE status = 'success';
