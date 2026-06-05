-- Etapa 4: el módulo "Buckets" pasa a "Almacenamiento". Un destino puede ser un
-- bucket GCS o una carpeta local (con su ruta). Se marca un destino por defecto
-- por tipo. La ruta local reemplaza a la variable BACKUP_DIR (que queda como
-- fallback inicial). El FK core.backup_jobs.bucket_id sigue válido tras el rename.

ALTER TABLE core.storage_buckets RENAME TO storage_targets;

ALTER TABLE core.storage_targets ADD COLUMN type text NOT NULL DEFAULT 'gcs' CHECK (type IN ('local', 'gcs'));
ALTER TABLE core.storage_targets ADD COLUMN path text;                 -- destino local
ALTER TABLE core.storage_targets ADD COLUMN is_default boolean NOT NULL DEFAULT false;

-- provider y bucket solo aplican a GCS.
ALTER TABLE core.storage_targets ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE core.storage_targets ALTER COLUMN provider DROP DEFAULT;
ALTER TABLE core.storage_targets ALTER COLUMN bucket DROP NOT NULL;

-- Campos obligatorios según el tipo.
ALTER TABLE core.storage_targets ADD CONSTRAINT storage_targets_type_fields CHECK (
  (type = 'gcs' AND bucket IS NOT NULL) OR (type = 'local' AND path IS NOT NULL)
);

-- A lo sumo un destino por defecto por tipo.
CREATE UNIQUE INDEX storage_targets_one_default_per_type ON core.storage_targets (type) WHERE is_default;

-- Destino local por defecto inicial (ruta = valor por defecto de BACKUP_DIR; editable).
INSERT INTO core.storage_targets (name, type, path, is_active, is_default)
VALUES ('Local por defecto', 'local', '../../backups', true, true);
