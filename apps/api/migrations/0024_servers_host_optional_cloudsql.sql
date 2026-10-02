-- Etapa 4 (parte 26): el host deja de ser obligatorio en instancias Cloud SQL. El
-- export usa la API de Cloud SQL Admin (proyecto + instancia) y no se conecta a la
-- BD; el resto de instancias lo siguen necesitando.
ALTER TABLE core.servers ALTER COLUMN host DROP NOT NULL;
ALTER TABLE core.servers ADD CONSTRAINT servers_host_required
  CHECK (host IS NOT NULL OR is_cloud_sql);
