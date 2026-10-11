-- Instancias PostgreSQL alojadas en AlloyDB: el formulario de eventos sugiere el
-- dump paralelo (pg_parallel) y precarga el filtro de ruido de stderr de AlloyDB.
-- Una instancia no puede ser Cloud SQL y AlloyDB a la vez.
ALTER TABLE core.servers
  ADD COLUMN is_alloydb boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT servers_platform_chk CHECK (NOT (is_alloydb AND is_cloud_sql));
