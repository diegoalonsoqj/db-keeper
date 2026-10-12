-- Filtro por estado en Ejecuciones (p. ej. solo las fallidas): el estado es selectivo
-- para "failed" y la lista se ordena por creación descendente, así que el índice
-- compuesto resuelve filtro + orden + LIMIT sin recorrer todo el historial.
-- (Los demás filtros —evento, origen, ambiente, fechas— usan executions_job_idx /
-- executions_created_idx; el buscador por nombre es ILIKE sobre una tabla que crece
-- decenas de filas por día, no justifica un índice trigram.)
CREATE INDEX executions_status_created_idx ON core.executions (status, created_at DESC);
