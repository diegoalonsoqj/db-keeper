-- Descargar un backup expone el contenido completo de la BD: deja de ir con
-- `backups:read` y pasa a un permiso propio, de entrada solo superadmin y admin
-- (a otros roles se les puede otorgar desde Roles).
INSERT INTO auth.permissions (key, category, description) VALUES
  ('backups:download', 'backups', 'Descargar archivos de backup')
ON CONFLICT (key) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_key)
SELECT r.id, 'backups:download' FROM auth.roles r WHERE r.key IN ('superadmin', 'admin')
ON CONFLICT DO NOTHING;
