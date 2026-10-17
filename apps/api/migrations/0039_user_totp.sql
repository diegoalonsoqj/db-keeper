-- Segundo factor TOTP para usuarios locales.
--   totp_secret_enc: secreto cifrado (AES-GCM de la app); existe desde que se inicia la
--                    activación, pero solo cuenta cuando totp_enabled_at no es NULL.
--   totp_last_step:  último paso de 30 s aceptado, para que un código no se reutilice.
ALTER TABLE auth.users
  ADD COLUMN totp_secret_enc text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step bigint;

-- Códigos de recuperación de un solo uso (solo el hash SHA-256).
CREATE TABLE auth.user_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
