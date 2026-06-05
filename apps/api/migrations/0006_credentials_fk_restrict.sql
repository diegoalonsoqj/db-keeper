-- Etapa 3 (parte 1): coherencia en el borrado de credenciales.
-- La 0005 dejó la FK como ON DELETE SET NULL, que contradice la regla del
-- service (bloquear el borrado si la credencial está en uso). Se cambia a
-- RESTRICT para que la BD garantice la misma invariante y se cierre la
-- carrera entre el count(*) y el DELETE del service (TOCTOU).

ALTER TABLE core.servers DROP CONSTRAINT servers_credential_id_fkey;

ALTER TABLE core.servers
  ADD CONSTRAINT servers_credential_id_fkey
  FOREIGN KEY (credential_id) REFERENCES secrets.credentials(id) ON DELETE RESTRICT;
