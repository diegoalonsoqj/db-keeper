-- Etapa 4: catálogo de ambientes. `core.servers.environment` sigue siendo texto;
-- este catálogo alimenta el selector de la instancia para mantener nombres
-- consistentes (evita "PROD" vs "prod" vs "Producción"). No hay FK: la instancia
-- guarda el nombre elegido como texto.

CREATE TABLE core.environments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Único sin distinguir mayúsculas/minúsculas.
CREATE UNIQUE INDEX environments_name_key ON core.environments (lower(name));
CREATE TRIGGER environments_set_updated_at BEFORE UPDATE ON core.environments
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- Semilla: los ambientes ya usados en instancias (uno por nombre, ci).
INSERT INTO core.environments (name)
SELECT DISTINCT ON (lower(environment)) environment
FROM core.servers
WHERE environment IS NOT NULL AND btrim(environment) <> ''
ORDER BY lower(environment);
