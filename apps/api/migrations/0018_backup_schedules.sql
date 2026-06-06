-- Etapa 4 (fase 3): programación de eventos de backup. Una programación por evento:
-- `once` (fecha/hora única) o `recurring` (cron). El scheduler in-proceso dispara
-- cuando next_run_at vence y recalcula el siguiente. Es agnóstico al motor: solo
-- crea la ejecución (origin 'scheduled') y el runner hace el dump según el motor.

CREATE TABLE core.backup_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL UNIQUE REFERENCES core.backup_jobs(id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('once', 'recurring')),
  run_at       timestamptz,           -- modo once
  cron         text,                  -- modo recurring (expresión cron)
  timezone     text NOT NULL,         -- zona para interpretar cron/run_at
  is_active    boolean NOT NULL DEFAULT true,
  next_run_at  timestamptz,           -- próximo disparo calculado
  last_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_schedules_mode_fields CHECK (
    (mode = 'once' AND run_at IS NOT NULL) OR (mode = 'recurring' AND cron IS NOT NULL)
  )
);
CREATE INDEX backup_schedules_due_idx ON core.backup_schedules (next_run_at) WHERE is_active;
CREATE TRIGGER backup_schedules_set_updated_at BEFORE UPDATE ON core.backup_schedules
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();
