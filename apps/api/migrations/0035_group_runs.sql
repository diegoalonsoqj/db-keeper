-- Corridas de grupo: cada disparo de un grupo crea una fila que agrupa sus ejecuciones.
-- Permite saber cuándo terminó el grupo entero y enviar un solo resumen (✅/❌ por
-- evento) en vez de un aviso suelto por cada evento.

-- Avisos del grupo. notify_mode: qué avisos individuales de cada evento salen además
-- del resumen final ('summary' = ninguno, 'summary_failures' = solo los fallos al
-- momento, 'all' = todos, como un evento suelto). Los grupos existentes quedan en 'all'
-- (siguen recibiendo los avisos de siempre); los nuevos nacen en 'summary'.
ALTER TABLE core.job_groups
  ADD COLUMN notify_start boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_mode  text    NOT NULL DEFAULT 'all'
    CHECK (notify_mode IN ('summary', 'summary_failures', 'all'));
ALTER TABLE core.job_groups ALTER COLUMN notify_mode SET DEFAULT 'summary';

-- group_name, notify_mode y skipped son snapshot del disparo: el resumen no cambia
-- aunque el grupo se edite o se borre a mitad de la corrida.
CREATE TABLE core.group_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid REFERENCES core.job_groups(id) ON DELETE SET NULL,
  group_name      text NOT NULL,
  origin          text NOT NULL,
  notify_mode     text NOT NULL,
  -- Eventos omitidos al disparar (inactivos o sin BD), por nombre.
  skipped         text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  -- Marca de "resumen enviado": se reclama con UPDATE condicional (un solo envío).
  summary_sent_at timestamptz
);
-- Barrido de corridas abiertas tras cada ejecución de la cola.
CREATE INDEX group_runs_open_idx ON core.group_runs (created_at) WHERE summary_sent_at IS NULL;

ALTER TABLE core.executions
  ADD COLUMN group_run_id uuid REFERENCES core.group_runs(id) ON DELETE SET NULL;
CREATE INDEX executions_group_run_idx ON core.executions (group_run_id) WHERE group_run_id IS NOT NULL;
