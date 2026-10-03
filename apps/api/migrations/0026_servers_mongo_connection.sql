-- Etapa 4 (parte 28): conexión de MongoDB en la instancia. El tipo SRV (Atlas,
-- `mongodb+srv://`) y las opciones de conexión pasan del evento a la instancia, para
-- que el descubrimiento y el dump usen la misma configuración.
ALTER TABLE core.servers
  ADD COLUMN mongo_srv boolean NOT NULL DEFAULT false,
  ADD COLUMN conn_options jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Antes el SRV se activaba por host de Atlas (.mongodb.net) o con la casilla del evento.
UPDATE core.servers s SET mongo_srv = true
WHERE s.engine = 'mongo'
  AND (s.host ILIKE '%.mongodb.net'
       OR EXISTS (SELECT 1 FROM core.backup_jobs j
                  WHERE j.server_id = s.id AND j.options->>'mongoSrv' = 'true'));

UPDATE core.backup_jobs SET options = options - 'mongoSrv' WHERE options ? 'mongoSrv';
