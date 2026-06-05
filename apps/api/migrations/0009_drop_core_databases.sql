-- Etapa 4: la selección de BDs por instancia (core.databases) queda superada por
-- el evento de backup (core.backup_job_databases). El descubrimiento en vivo se
-- conserva; solo se elimina la persistencia por instancia.

DROP TABLE IF EXISTS core.databases;
