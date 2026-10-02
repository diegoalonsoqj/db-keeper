-- Etapa 4 (parte 25): reenganche del export de Cloud SQL tras un reinicio. Se guarda
-- el nombre de la operación al lanzarla para volver a seguirla cuando arranque la API
-- (el export sigue corriendo en GCP aunque el proceso que lo seguía muera).
ALTER TABLE core.execution_items ADD COLUMN cloudsql_operation text;
