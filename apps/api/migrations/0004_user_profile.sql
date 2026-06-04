-- Correcciones UX: preferencias y avatar por usuario.
ALTER TABLE auth.users
  ADD COLUMN avatar text,                              -- data URL de imagen pequeña (opcional)
  ADD COLUMN preferred_language text,                  -- 'es-419' | 'en' | null (usa el por defecto)
  ADD COLUMN preferred_theme text                      -- 'dark' | 'light' | null
    CHECK (preferred_theme IS NULL OR preferred_theme IN ('dark', 'light'));
