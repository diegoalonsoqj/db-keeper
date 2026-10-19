-- Usar una credencial guardada con un destino nuevo envía su contraseña a ese host:
-- con `servers:write` bastaba apuntar una instancia propia a una credencial ajena.
-- `credentials:use` (de entrada solo superadmin y admin) permite esas combinaciones;
-- sin él, cada usuario solo usa libremente las credenciales cuya contraseña escribió
-- (password_set_by). Las existentes quedan sin dueño: sus vínculos actuales siguen
-- valiendo, los nuevos los hace quien tenga el permiso.
ALTER TABLE secrets.credentials
  ADD COLUMN password_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

INSERT INTO auth.permissions (key, category, description) VALUES
  ('credentials:use', 'servers', 'Usar credenciales guardadas con instancias o eventos nuevos y cambiar el destino de instancias con credencial')
ON CONFLICT (key) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_key)
SELECT r.id, 'credentials:use' FROM auth.roles r WHERE r.key IN ('superadmin', 'admin')
ON CONFLICT DO NOTHING;
