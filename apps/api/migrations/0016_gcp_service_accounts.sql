-- Etapa 4: catálogo de cuentas de servicio GCP (clave JSON reutilizable). Un destino
-- GCS deja de guardar la clave incrustada y referencia una cuenta del catálogo. La
-- clave JSON se guarda cifrada; client_email/project_id son metadatos no secretos.

CREATE TABLE secrets.gcp_service_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  client_email  text,                 -- extraído del JSON (no secreto)
  project_id    text,                 -- extraído del JSON (no secreto)
  key_encrypted text NOT NULL,        -- JSON completo de la cuenta, cifrado
  is_active     boolean NOT NULL DEFAULT true,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gcp_sa_name_lower_idx ON secrets.gcp_service_accounts (lower(name));
-- A lo sumo una cuenta por defecto.
CREATE UNIQUE INDEX gcp_sa_one_default ON secrets.gcp_service_accounts (is_default) WHERE is_default;
CREATE TRIGGER gcp_sa_set_updated_at BEFORE UPDATE ON secrets.gcp_service_accounts
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- El destino GCS referencia una cuenta de servicio del catálogo.
ALTER TABLE core.storage_targets
  ADD COLUMN gcp_service_account_id uuid REFERENCES secrets.gcp_service_accounts(id) ON DELETE SET NULL;

-- Migrar las claves inline existentes al catálogo y enlazarlas (nombre único por destino).
INSERT INTO secrets.gcp_service_accounts (name, key_encrypted)
SELECT 'SA ' || name, service_account_encrypted
FROM core.storage_targets
WHERE service_account_encrypted IS NOT NULL;

UPDATE core.storage_targets st
SET gcp_service_account_id = sa.id
FROM secrets.gcp_service_accounts sa
WHERE st.service_account_encrypted IS NOT NULL AND sa.name = 'SA ' || st.name;

ALTER TABLE core.storage_targets DROP COLUMN service_account_encrypted;
