-- Revocación de sesiones (JWT stateless de 8 h).
-- session_version: cada token lleva la versión vigente al emitirse; subirla invalida
-- todos los anteriores (cambio de contraseña, alta o baja del segundo factor). Es un
-- contador y no una fecha para no depender del reloj de la app ni del de la BD.
-- revoked_sessions: tokens sueltos cerrados con logout; la fila solo hace falta hasta
-- que el token vence por sí solo.
ALTER TABLE auth.users ADD COLUMN session_version integer NOT NULL DEFAULT 0;

CREATE TABLE auth.revoked_sessions (
  jti        text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX revoked_sessions_expires_at_idx ON auth.revoked_sessions (expires_at);
