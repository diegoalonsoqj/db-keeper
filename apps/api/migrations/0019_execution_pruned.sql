-- Etapa 4 (parte 21): retención de backups. Cuando un dump expira por la política
-- de retención del evento (antigüedad y/o cantidad), se borra el archivo físico
-- (disco local o GCS) pero se conserva el registro de la ejecución para auditoría:
-- el ítem queda marcado con pruned_at y deja de ser descargable.
ALTER TABLE core.execution_items ADD COLUMN pruned_at timestamptz;
