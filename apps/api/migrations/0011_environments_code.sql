-- Etapa 4: el ambiente pasa a tener nombre + código. El **código** (p. ej. PRD,
-- UAT, DEV, PPR) es lo que se usa en el nombre del backup; el nombre es la etiqueta
-- legible (p. ej. "Producción"). El selector muestra "Nombre (CÓDIGO)" y la instancia
-- guarda el código como texto en core.servers.environment.

ALTER TABLE core.environments ADD COLUMN code text;

-- Poblar el código de las filas existentes a partir del nombre (alfanumérico, mayúsculas).
UPDATE core.environments
SET code = upper(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))
WHERE code IS NULL;
UPDATE core.environments SET code = 'ENV' WHERE code IS NULL OR code = '';

ALTER TABLE core.environments ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX environments_code_key ON core.environments (lower(code));
