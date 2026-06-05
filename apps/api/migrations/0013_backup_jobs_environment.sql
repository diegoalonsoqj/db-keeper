-- Etapa 4: el evento de backup consolida y guarda el ambiente (código). Debe
-- coincidir el ambiente de la instancia con el de la credencial efectiva; la API
-- valida la consistencia al crear/editar y persiste el código aquí.

ALTER TABLE core.backup_jobs ADD COLUMN environment text;

-- Backfill: tomar el ambiente de la instancia de cada evento existente.
UPDATE core.backup_jobs j
SET environment = s.environment
FROM core.servers s
WHERE s.id = j.server_id AND s.environment IS NOT NULL AND btrim(s.environment) <> '';
