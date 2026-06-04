-- Etapa 0: esquemas base de la BD de metadatos (ver spec §10.2).
-- Separar responsabilidades y aislar secretos para aplicar permisos más estrictos.
--   auth    -> usuarios, roles, permisos, sesiones.
--   core    -> entidades operativas: instancias, bases, trabajos, programaciones, ejecuciones.
--   secrets -> credenciales y secretos cifrados, aislados del resto.
--   audit   -> registro de auditoría de acciones de usuario.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS secrets;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA auth IS 'Usuarios, roles y permisos (RBAC).';
COMMENT ON SCHEMA core IS 'Entidades operativas: instancias, bases, trabajos, programaciones, ejecuciones.';
COMMENT ON SCHEMA secrets IS 'Credenciales y secretos cifrados (AES-256-GCM a nivel de aplicación).';
COMMENT ON SCHEMA audit IS 'Registro de auditoría de acciones de usuario.';
