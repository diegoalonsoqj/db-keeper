-- Límite de intentos de login y de código TOTP. Antes vivía en memoria: se reiniciaba
-- con cada restart y no se compartía entre instancias. Claves: `user:<usuario>`,
-- `ip:<ip>`, `mfa:<id>`. Las filas sin bloqueo vigente se borran a las 24 h.
CREATE TABLE auth.login_attempts (
  key          text PRIMARY KEY,
  fails        integer NOT NULL,
  first_at     timestamptz NOT NULL,
  locked_until timestamptz
);
CREATE INDEX login_attempts_first_at_idx ON auth.login_attempts (first_at);
