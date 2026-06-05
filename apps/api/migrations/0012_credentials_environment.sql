-- Etapa 4: la credencial puede etiquetarse con un ambiente (código del catálogo
-- core.environments), igual que la instancia. Se guarda el código como texto (sin
-- FK), alimentado por el mismo selector "Nombre (CÓDIGO)".

ALTER TABLE secrets.credentials ADD COLUMN environment text;
