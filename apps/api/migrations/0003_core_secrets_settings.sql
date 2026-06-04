-- Etapa 2: instancias, credenciales cifradas, buckets y configuración del sistema.

-- ─────────────────────────────────────────────────────────────
-- core.servers — instancias de base de datos a respaldar
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core.servers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  engine      text NOT NULL CHECK (engine IN ('sqlserver', 'mysql', 'postgres', 'mongo')),
  host        text NOT NULL,
  port        integer NOT NULL CHECK (port > 0 AND port <= 65535),
  environment text,                                  -- producción / pruebas / etc.
  use_ssl     boolean NOT NULL DEFAULT false,
  -- Instancia gestionada en Cloud SQL (habilita el método gcloud en etapas futuras).
  is_cloud_sql    boolean NOT NULL DEFAULT false,
  gcp_project     text,
  gcp_instance    text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX servers_name_lower_idx ON core.servers (lower(name));
CREATE TRIGGER servers_set_updated_at BEFORE UPDATE ON core.servers
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- secrets.credentials — credenciales de acceso (cifradas, 1:1 con la instancia)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE secrets.credentials (
  server_id          uuid PRIMARY KEY REFERENCES core.servers(id) ON DELETE CASCADE,
  username           text NOT NULL,
  password_encrypted text NOT NULL,                  -- AES-256-GCM (base64)
  extra_encrypted    text,                           -- JSON cifrado (clave de servicio GCP, etc.)
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER credentials_set_updated_at BEFORE UPDATE ON secrets.credentials
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- core.storage_buckets — destinos de almacenamiento (GCS)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core.storage_buckets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  provider    text NOT NULL DEFAULT 'gcs' CHECK (provider IN ('gcs')),
  bucket      text NOT NULL,                         -- nombre del bucket (sin gs://)
  prefix      text,                                  -- ruta/prefijo opcional dentro del bucket
  service_account_encrypted text,                    -- clave de servicio GCP cifrada (opcional)
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX storage_buckets_name_lower_idx ON core.storage_buckets (lower(name));
CREATE TRIGGER storage_buckets_set_updated_at BEFORE UPDATE ON core.storage_buckets
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- core.app_settings — configuración del sistema (clave → valor jsonb)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core.app_settings (
  key        text PRIMARY KEY,                       -- 'general', 'ldap', …
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER app_settings_set_updated_at BEFORE UPDATE ON core.app_settings
  FOR EACH ROW EXECUTE FUNCTION core_set_updated_at();

-- Valores por defecto.
INSERT INTO core.app_settings (key, value) VALUES
  ('general', '{"timezone": "America/Lima", "defaultLanguage": "es-419"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
