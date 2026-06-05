-- Etapa 3 (parte 2): descubrimiento de instancias → selección de BDs.
-- core.databases guarda las bases de datos seleccionadas para respaldar de cada
-- instancia. El descubrimiento (listar las BDs reales) se hace en vivo conectando
-- a la instancia; aquí solo persiste la selección del usuario.

CREATE TABLE core.databases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   uuid NOT NULL REFERENCES core.servers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  schemas     jsonb,                       -- esquemas a incluir (Postgres); se llena en una iteración posterior
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Una BD por instancia (sin distinción de mayúsculas en el nombre).
CREATE UNIQUE INDEX databases_server_name_idx ON core.databases (server_id, lower(name));
CREATE INDEX databases_server_idx ON core.databases (server_id);

CREATE TRIGGER databases_set_updated_at BEFORE UPDATE ON core.databases
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();
