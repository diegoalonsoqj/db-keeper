-- Etapa 4: generalización multi-nube (de momento solo GCP funcional).
-- - secrets.gcp_service_accounts -> secrets.cloud_credentials con `provider`
--   (gcp|aws|azure), `secret_encrypted` (payload propio de la nube) y `metadata`
--   jsonb (datos no secretos para mostrar). Default por proveedor.
-- - core.storage_targets: el destino de nube pasa de type 'gcs' a type 'bucket'
--   con `provider`; referencia genérica `cloud_credential_id`.

-- ===== Cuentas de servicio (multi-nube) =====
ALTER TABLE secrets.gcp_service_accounts RENAME TO cloud_credentials;
ALTER TABLE secrets.cloud_credentials RENAME COLUMN key_encrypted TO secret_encrypted;
ALTER TABLE secrets.cloud_credentials
  ADD COLUMN provider text NOT NULL DEFAULT 'gcp' CHECK (provider IN ('gcp', 'aws', 'azure'));
ALTER TABLE secrets.cloud_credentials ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Mover los metadatos GCP (no secretos) a `metadata`.
UPDATE secrets.cloud_credentials
SET metadata = jsonb_strip_nulls(jsonb_build_object('clientEmail', client_email, 'projectId', project_id))
WHERE provider = 'gcp';
ALTER TABLE secrets.cloud_credentials DROP COLUMN client_email;
ALTER TABLE secrets.cloud_credentials DROP COLUMN project_id;

-- Default por proveedor (reemplaza el default único global).
DROP INDEX secrets.gcp_sa_one_default;
CREATE UNIQUE INDEX cloud_cred_one_default_per_provider
  ON secrets.cloud_credentials (provider) WHERE is_default;

-- ===== Destinos de almacenamiento (bucket multi-nube) =====
ALTER TABLE core.storage_targets RENAME COLUMN gcp_service_account_id TO cloud_credential_id;
ALTER TABLE core.storage_targets DROP CONSTRAINT storage_buckets_provider_check;
ALTER TABLE core.storage_targets DROP CONSTRAINT storage_targets_type_check;
ALTER TABLE core.storage_targets DROP CONSTRAINT storage_targets_type_fields;

-- Migrar valores: type gcs -> bucket, provider gcs -> gcp.
UPDATE core.storage_targets SET type = 'bucket', provider = 'gcp' WHERE type = 'gcs';

ALTER TABLE core.storage_targets
  ADD CONSTRAINT storage_targets_type_check CHECK (type IN ('local', 'bucket'));
ALTER TABLE core.storage_targets
  ADD CONSTRAINT storage_targets_provider_check CHECK (provider IS NULL OR provider IN ('gcp', 'aws', 'azure'));
ALTER TABLE core.storage_targets ADD CONSTRAINT storage_targets_type_fields CHECK (
  (type = 'bucket' AND bucket IS NOT NULL AND provider IS NOT NULL) OR
  (type = 'local' AND path IS NOT NULL)
);
