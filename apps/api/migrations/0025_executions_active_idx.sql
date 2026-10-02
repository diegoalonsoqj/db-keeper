-- Etapa 4 (parte 27): cola de ejecuciones. El planificador consulta cada 30 s las
-- ejecuciones `pending` (cola, por orden de creación) y `running` (instancias
-- ocupadas). Índice parcial: solo indexa las activas, que son pocas, aunque el
-- historial crezca.
CREATE INDEX executions_active_idx ON core.executions (created_at)
  WHERE status IN ('pending', 'running');
