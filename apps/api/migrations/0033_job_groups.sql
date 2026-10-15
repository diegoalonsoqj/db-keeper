-- Grupos de eventos: se programan o lanzan juntos. Al dispararse, cada evento activo
-- del grupo crea su propia ejecución (exports de Cloud SQL primero, luego por posición)
-- y la cola decide el paralelismo como con cualquier ejecución. Un evento puede estar en
-- varios grupos y conserva su programación propia.

CREATE TABLE core.job_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_groups_name_uq ON core.job_groups (lower(name));
CREATE TRIGGER job_groups_set_updated_at BEFORE UPDATE ON core.job_groups
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

CREATE TABLE core.job_group_members (
  group_id uuid NOT NULL REFERENCES core.job_groups(id) ON DELETE CASCADE,
  job_id   uuid NOT NULL REFERENCES core.backup_jobs(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (group_id, job_id)
);
-- "¿En qué grupos está este evento?" (columna Grupos en Eventos).
CREATE INDEX job_group_members_job_idx ON core.job_group_members (job_id);

-- Programación de un evento **o** de un grupo (una por cada uno).
ALTER TABLE core.backup_schedules ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE core.backup_schedules
  ADD COLUMN group_id uuid UNIQUE REFERENCES core.job_groups(id) ON DELETE CASCADE,
  ADD CONSTRAINT backup_schedules_target CHECK ((job_id IS NULL) <> (group_id IS NULL));

-- Ejecuciones lanzadas por un grupo. group_name es snapshot (como label): el historial
-- y los avisos lo conservan aunque el grupo se renombre o se borre.
ALTER TABLE core.executions
  ADD COLUMN group_id uuid REFERENCES core.job_groups(id) ON DELETE SET NULL,
  ADD COLUMN group_name text;
-- Filtro por grupo en Ejecuciones (ordenado por creación, como el resto de filtros).
CREATE INDEX executions_group_created_idx ON core.executions (group_id, created_at DESC)
  WHERE group_id IS NOT NULL;

-- Permisos nuevos. Los roles existentes los reciben según los de backups que ya tienen
-- (respeta los cambios hechos a los roles): leer → ver grupos, programar → editarlos,
-- ejecutar → lanzarlos.
INSERT INTO auth.permissions (key, category, description) VALUES
  ('groups:read', 'groups', 'Ver grupos de eventos'),
  ('groups:write', 'groups', 'Crear, editar y programar grupos de eventos'),
  ('groups:run', 'groups', 'Ejecutar grupos de eventos a demanda')
ON CONFLICT (key) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_key)
SELECT rp.role_id, m.new_key
FROM auth.role_permissions rp
JOIN (VALUES ('backups:read', 'groups:read'),
             ('backups:schedule', 'groups:write'),
             ('backups:run', 'groups:run')) AS m(old_key, new_key)
  ON rp.permission_key = m.old_key
ON CONFLICT DO NOTHING;
