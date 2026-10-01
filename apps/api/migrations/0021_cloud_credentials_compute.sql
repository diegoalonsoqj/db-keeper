-- Etapa 4 (parte 23): cuenta de servicio de la VM (Compute Engine). Una credencial
-- `compute` no guarda clave: se autentica con la identidad de la VM donde corre
-- DBKeeper (servidor de metadatos / ADC). Las `key` siguen guardando el JSON cifrado.
ALTER TABLE secrets.cloud_credentials
  ADD COLUMN kind text NOT NULL DEFAULT 'key' CHECK (kind IN ('key', 'compute'));
ALTER TABLE secrets.cloud_credentials ALTER COLUMN secret_encrypted DROP NOT NULL;
ALTER TABLE secrets.cloud_credentials ADD CONSTRAINT cloud_credentials_secret_by_kind
  CHECK ((kind = 'key') = (secret_encrypted IS NOT NULL));
-- Una sola entrada de VM por proveedor (la identidad de la VM es única).
CREATE UNIQUE INDEX cloud_cred_one_compute_per_provider
  ON secrets.cloud_credentials (provider) WHERE kind = 'compute';
