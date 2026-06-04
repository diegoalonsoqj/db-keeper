-- Etapa 1: autenticación, RBAC y auditoría.
-- gen_random_uuid() viene en pgcrypto (incluido en PostgreSQL 16 core).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigger genérico para mantener updated_at.
CREATE OR REPLACE FUNCTION core_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- Usuarios (locales y de AD)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  email         text,
  full_name     text,
  auth_type     text NOT NULL DEFAULT 'local' CHECK (auth_type IN ('local', 'ad')),
  -- Solo para usuarios locales; los de AD se validan contra LDAP.
  password_hash text,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Un usuario local debe tener hash; uno de AD no almacena contraseña.
  CONSTRAINT users_local_has_hash CHECK (
    (auth_type = 'local' AND password_hash IS NOT NULL) OR
    (auth_type = 'ad' AND password_hash IS NULL)
  )
);
CREATE UNIQUE INDEX users_username_lower_idx ON auth.users (lower(username));
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Roles, permisos y sus relaciones (RBAC configurable)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE auth.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  -- Roles de sistema (los 5 base): no se pueden eliminar; superadmin tampoco editar permisos.
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON auth.roles
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

CREATE TABLE auth.permissions (
  key         text PRIMARY KEY,
  category    text NOT NULL,
  description text NOT NULL
);

CREATE TABLE auth.role_permissions (
  role_id        uuid NOT NULL REFERENCES auth.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES auth.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE auth.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES auth.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON auth.user_roles (role_id);

-- ─────────────────────────────────────────────────────────────
-- Auditoría de acciones de usuario
-- ─────────────────────────────────────────────────────────────
CREATE TABLE audit.activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot del nombre por si el usuario se elimina después.
  username    text,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  ip          text,
  user_agent  text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_created_idx ON audit.activity_log (created_at DESC);
CREATE INDEX activity_log_user_idx ON audit.activity_log (user_id);
CREATE INDEX activity_log_action_idx ON audit.activity_log (action);
