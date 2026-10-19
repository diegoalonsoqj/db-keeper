-- Destinos de backup y credenciales de nube deciden A DÓNDE salen los datos: con
-- `servers:write` un editor podía registrar un bucket propio (con su cuenta de
-- servicio) y mandarle el dump completo de una base de producción. `storage:manage`
-- (de entrada solo superadmin y admin) gestiona destinos y credenciales de nube y
-- permite rutas de red como carpeta del .bak de SQL Server. Elegir entre los
-- existentes sigue sin pedirlo.
INSERT INTO auth.permissions (key, category, description) VALUES
  ('storage:manage', 'servers', 'Gestionar destinos de backup (carpetas locales y buckets) y credenciales de nube')
ON CONFLICT (key) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_key)
SELECT r.id, 'storage:manage' FROM auth.roles r WHERE r.key IN ('superadmin', 'admin')
ON CONFLICT DO NOTHING;
