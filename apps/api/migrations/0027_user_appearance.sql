-- Apariencia por usuario (Configuración → Apariencia): paleta de color y modo
-- 'system' (sigue al sistema operativo). NULL = el usuario aún no eligió.
ALTER TABLE auth.users
  ADD COLUMN preferred_palette text
    CHECK (preferred_palette IS NULL OR preferred_palette IN ('cyan', 'indigo', 'emerald'));

ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_preferred_theme_check;
ALTER TABLE auth.users ADD CONSTRAINT users_preferred_theme_check
  CHECK (preferred_theme IS NULL OR preferred_theme IN ('dark', 'light', 'system'));
