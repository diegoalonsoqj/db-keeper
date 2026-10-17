-- Catálogo de proyectos GCP. Como con los ambientes (0010), `core.servers.gcp_project`
-- sigue siendo texto y no hay FK: el catálogo alimenta el selector de la instancia.

CREATE TABLE core.gcp_projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL,
  name        text,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gcp_projects_project_id_key ON core.gcp_projects (lower(project_id));
CREATE TRIGGER gcp_projects_set_updated_at BEFORE UPDATE ON core.gcp_projects
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- Semilla: los proyectos ya usados en instancias y en cuentas de servicio GCP.
INSERT INTO core.gcp_projects (project_id)
SELECT DISTINCT ON (lower(p)) p
FROM (
  SELECT btrim(gcp_project) AS p FROM core.servers WHERE gcp_project IS NOT NULL
  UNION
  SELECT btrim(metadata->>'projectId') FROM secrets.cloud_credentials WHERE metadata ? 'projectId'
) t
WHERE p <> ''
ORDER BY lower(p);
