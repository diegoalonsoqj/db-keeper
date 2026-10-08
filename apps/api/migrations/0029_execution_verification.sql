-- Verificación de integridad a demanda ("Verificar ahora"): vuelve a calcular la
-- huella del archivo guardado y la compara con la registrada al generarlo
-- (file_sha256/file_md5/file_crc32c). Guarda solo el último resultado.
--   quick: metadata del objeto en GCS (sin descargar)
--   deep:  relee el archivo completo (siempre en disco local)
ALTER TABLE core.execution_items
  ADD COLUMN verify_status text
    CHECK (verify_status IS NULL OR verify_status IN ('running', 'ok', 'mismatch', 'missing', 'error')),
  ADD COLUMN verify_mode text CHECK (verify_mode IS NULL OR verify_mode IN ('quick', 'deep')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verify_detail text;
