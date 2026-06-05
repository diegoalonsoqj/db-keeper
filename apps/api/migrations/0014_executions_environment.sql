-- Etapa 4: la ejecución guarda (snapshot) el ambiente del evento al momento de
-- correr, igual que el label, para mostrarlo en el historial aunque el evento cambie.

ALTER TABLE core.executions ADD COLUMN environment text;

-- Backfill desde el evento asociado (si aún existe).
UPDATE core.executions e
SET environment = j.environment
FROM core.backup_jobs j
WHERE j.id = e.job_id AND j.environment IS NOT NULL;
