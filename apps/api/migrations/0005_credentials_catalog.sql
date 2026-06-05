-- Etapa 3 (parte 1): catálogo de credenciales reutilizables.
-- Antes: secrets.credentials era 1:1 con core.servers (credencial embebida).
-- Ahora: secrets.credentials es un catálogo (un "usuario de backups" reutilizable)
-- y cada instancia referencia una credencial por credential_id (muchas a una).

ALTER TABLE secrets.credentials RENAME TO credentials_old;

CREATE TABLE secrets.credentials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  username           text NOT NULL,
  password_encrypted text NOT NULL,                 -- AES-256-GCM (base64)
  extra_encrypted    text,                           -- JSON cifrado (clave GCP, etc.)
  description        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credentials_name_lower_idx ON secrets.credentials (lower(name));
CREATE TRIGGER credentials_set_updated_at BEFORE UPDATE ON secrets.credentials
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- Una instancia usa una credencial del catálogo (opcional hasta asignarla).
ALTER TABLE core.servers
  ADD COLUMN credential_id uuid REFERENCES secrets.credentials(id) ON DELETE SET NULL;

-- Migrar las credenciales 1:1 existentes al catálogo y enlazarlas.
DO $$
DECLARE r RECORD; new_id uuid;
BEGIN
  FOR r IN
    SELECT co.server_id, co.username, co.password_encrypted, co.extra_encrypted, s.name AS server_name
    FROM secrets.credentials_old co
    JOIN core.servers s ON s.id = co.server_id
  LOOP
    INSERT INTO secrets.credentials (name, username, password_encrypted, extra_encrypted)
    VALUES (r.server_name || ' - credencial', r.username, r.password_encrypted, r.extra_encrypted)
    RETURNING id INTO new_id;
    UPDATE core.servers SET credential_id = new_id WHERE id = r.server_id;
  END LOOP;
END $$;

DROP TABLE secrets.credentials_old;
