-- Checksums del archivo de backup para validar su integridad al descargarlo.
-- file_sha256: hex, calculado por DBKeeper sobre el dump local (PG/MySQL/Mongo).
-- file_md5 (hex) y file_crc32c (base64, formato de GCS): del objeto en el bucket;
-- únicos disponibles en el export de Cloud SQL, donde el archivo nunca pasa por la API.
ALTER TABLE core.execution_items
  ADD COLUMN file_sha256 text,
  ADD COLUMN file_md5 text,
  ADD COLUMN file_crc32c text;
