# Arquitectura

DBKeeper es un monorepo TypeScript con tres paquetes: una API (Express 5), una SPA
(React + Vite) y un paquete de contratos compartidos. Este documento describe lo
construido hasta la **Etapa 1**; las piezas de etapas futuras se marcan como tal.

## Componentes

| Componente | Estado | Descripción |
|---|---|---|
| **API / Backend** | ✅ | REST sobre Express 5, estructura en capas, sesión por cookie. |
| **Web / SPA** | ✅ | React + Vite, i18n `es-419`/`en`, RBAC en el cliente. |
| **BD de metadatos** | ✅ | PostgreSQL 16 (esquemas `auth`/`core`/`secrets`/`audit`). |
| **Motor de ejecución** | ◑ Etapa 4 | Vuelca cada BD en segundo plano dentro de la API (in-proceso). **PostgreSQL** (`pg_dump`), **MySQL** (`mysqldump`) y **MongoDB** (`mongodump`, Atlas/Community) listos + subida a GCS; SQL Server pendiente. |
| **Programador** | ✅ Etapa 4 | Poller in-proceso (60 s) sobre `core.backup_schedules`; dispara `once`/`recurring` (cron), agnóstico al motor. |
| **Cola / tiempo real** | ⏳ Etapa 4–5 | Redis + BullMQ; progreso por WebSocket/SSE. Hoy el motor corre in-proceso, sin cola. |

## Capas de la API

```
HTTP → routes (controllers)  →  services (lógica)  →  repositories (acceso a datos) → PostgreSQL
                 │                      │
            validación Zod        reglas de negocio
            authn/authz           y errores tipados
```

- **routes**: definen endpoints, validan entrada con Zod, registran auditoría y
  delegan en servicios. Sin lógica de negocio ni SQL.
- **services**: reglas de negocio, orquestación y errores (`HttpError`).
- **repositories**: única capa con SQL, siempre **parametrizado**.
- **middleware**: `authenticate` (verifica la cookie JWT y carga la identidad) y
  `authorize(permiso)`; manejo de errores centralizado con respuesta uniforme.

Cada módulo vive en `apps/api/src/modules/<modulo>/` con sus archivos
`*.repository.ts`, `*.service.ts` y `*.routes.ts`.

### Respuesta uniforme

```jsonc
// éxito
{ "ok": true, "data": { /* ... */ } }
// error
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "…", "details": [] } }
```

## Esquemas de base de datos

Separación por responsabilidad (permite políticas de acceso más estrictas):

- **`auth`** — `users`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- **`audit`** — `activity_log` (quién, qué, cuándo, IP, user-agent, detalle).
- **`core`** — `servers` (instancias), `environments`, `storage_targets`, `app_settings`; y más
  adelante bases, trabajos y ejecuciones.
- **`secrets`** — `credentials`: **catálogo** de credenciales reutilizables, con
  contraseña/`extra` cifrados (una credencial puede usarse en varias instancias).

Migraciones SQL versionadas en `apps/api/migrations/`, aplicadas por un runner
propio que registra cada archivo en `public._migrations` dentro de una transacción.

### Modelo de datos (Etapa 1)

```
auth.users (id, username, email, full_name, auth_type[local|ad], password_hash?, is_active, …)
   └─< auth.user_roles >─┐
auth.roles (id, key, name, description, is_system)
   └─< auth.role_permissions >─┐
auth.permissions (key, category, description)

audit.activity_log (id, user_id?, username, action, entity_type?, entity_id?, ip?, detail, created_at)
```

### Modelo de datos (Etapa 2)

```
core.storage_targets (id, type[local|bucket], name, path?, provider?[gcp|aws|azure], bucket?, prefix?, cloud_credential_id? → secrets.cloud_credentials, is_active, is_default, …)
secrets.cloud_credentials (id, name, provider[gcp|aws|azure], secret_encrypted, metadata jsonb, is_active, is_default, …)
core.app_settings (key, value jsonb)   -- 'general' (timezone, idioma) · 'ldap' (config AD)
```

### Modelo de datos (Etapa 3 · parte 1)

El catálogo de credenciales reemplaza la relación 1:1 instancia–credencial: muchas
instancias pueden referenciar una misma credencial por `credential_id`.

```
secrets.credentials (id, name, username, password_encrypted, extra_encrypted, description, …)
   ^
   │ credential_id (FK, ON DELETE RESTRICT)
core.servers (id, name, engine, host, port, environment, use_ssl, is_cloud_sql, gcp_*, notes, credential_id?, …)
```

La FK es `ON DELETE RESTRICT`: una credencial en uso no puede borrarse; el service lo
verifica de antemano (409) y la BD lo garantiza ante condiciones de carrera.

El **descubrimiento** lista las bases reales de una instancia conectándose en vivo con
su credencial del catálogo. Hay un *discoverer* por motor en
`modules/databases/discovery/` (PostgreSQL, MySQL, SQL Server, Mongo); cada uno abre
una conexión con timeout, excluye las bases del sistema y devuelve los nombres. La
credencial se descifra solo en memoria y el error del driver se sanea para no filtrar
la contraseña. El descubrimiento alimenta el asistente del evento de backup; la
selección efectiva se guarda en el evento, no por instancia.

### Modelo de datos (Etapa 4 · parte 1)

```
core.backup_jobs (id, name, server_id → core.servers, credential_id? → secrets.credentials,
                  method[dump|gcloud], bucket_id? → core.storage_targets, options jsonb, is_active, …)
   └─< core.backup_job_databases (job_id, db_name) >   -- BDs del evento (multi-BD)

core.executions (id, job_id? → core.backup_jobs, label, status, origin[manual|scheduled],
                 started_at, finished_at, created_at)
   └─< core.execution_items (id, execution_id, db_name, status, file_name, file_bytes, log, …) >
```

Un **evento de backup** (`backup_jobs`) es la definición reutilizable; cada corrida
crea una **ejecución** (con su identificador propio) y un **ítem por BD**. La credencial
del evento puede heredarse de la instancia o ser un override.

**Motor de ejecución** (`modules/backups/engine/`): al lanzar un evento, un runner en
segundo plano (in-proceso, sin cola todavía) vuelca cada BD y actualiza los estados
`pending→running→success/failed` con archivo, peso y log por BD. PostgreSQL usa
`pg_dump -Fp` (`--no-owner --no-privileges --serializable-deferrable`, `--exclude-table`
por `options.excludeTables`) generando `backups/<motor>/{db}_{ambiente}_{timestamp}.sql[.gz]`
(gzip configurable por `options.compress`), con validación de integridad del `.gz` y
borrado del parcial si falla. El archivo se descarga desde *Ejecuciones* y el `log` por
BD queda disponible; una corrida fallida se puede **reintentar**. Las contraseñas viajan por `PGPASSWORD` y los argumentos como
array (sin shell). Al arrancar, las ejecuciones que quedaron en curso por un reinicio se
marcan `failed`. El destino GCS, el resto de motores, la cola (Redis/BullMQ) y el
scheduler son fases siguientes.

## Seguridad

- **Contraseñas locales**: hash **scrypt** (`node:crypto`), sin dependencias nativas;
  formato `scrypt$N$r$p$salt$hash` con comparación en tiempo constante.
- **AD/LDAP**: autenticación bind-search-bind contra Active Directory. El usuario de
  AD debe existir previamente en `auth.users` (provisionado por un admin con sus roles).
- **Sesión**: JWT HS256 (`jose`) firmado con `APP_SECRET_KEY`, en cookie
  `httpOnly`/`sameSite=lax` (`secure` en producción). Los permisos se resuelven
  desde la BD en cada request, no se confían del token.
- **RBAC**: permisos `recurso:acción` por rol, editables. `superadmin` siempre tiene
  todos los permisos y no es editable/eliminable.
- **Cifrado de secretos**: AES-256-GCM a nivel de aplicación (`lib/crypto.ts`) con
  `DBKEEPER_MASTER_KEY` (32 bytes base64). Contraseñas de instancias, claves de
  servicio GCP y contraseña de bind LDAP se cifran; nunca se guardan en claro ni se
  loguean ni se devuelven por la API.
- **Auditoría**: toda acción relevante se registra en `audit.activity_log`.
- **Endurecimiento HTTP**: `helmet`, CORS con credenciales, `trust proxy` para IP real.

## Configuración (12-factor)

El `.env` se mantiene **mínimo** (solo el arranque): clave de app, clave maestra de
cifrado, `DATABASE_URL`, `REDIS_URL` y logging. La configuración de LDAP está hoy en
`.env` de forma temporal y migrará al **módulo Settings** (BD) en la Etapa 2.
Validación estricta con Zod al arrancar (falla rápido si algo falta).

## Frontend

- **AuthContext** restaura la sesión (`/auth/me`) y expone `login`, `logout`,
  `has(permiso)`, `updateProfile` y `changePassword`. Al iniciar sesión aplica las
  **preferencias** del usuario (tema e idioma).
- **Guards**: `RequireAuth` (redirige a `/login`) y `RequirePermission` (oculta/redirige
  rutas según permiso). La navegación del layout se filtra por permiso.
- **Cliente API** tipado sobre `fetch` con `credentials: include` y manejo del sobre
  de respuesta uniforme.
- **i18n** con `react-i18next` (`es-419` por defecto, `en`), persistido en `localStorage`.

### UI / UX

- **Tema claro/oscuro** (`ThemeContext`): aplica `data-theme` en `<html>`, persiste en
  `localStorage` y respeta `prefers-color-scheme`; el usuario puede fijar un tema por
  defecto en su perfil.
- **Layout**: barra lateral **contraíble** (riel de iconos) con botón flotante sobre la
  divisoria y logo de marca; cabecera con menú de usuario.
- **Menú de usuario**: avatar (imagen o iniciales) + nombre/usuario, con *Ver mi perfil*,
  cambio de idioma y cerrar sesión.
- **Perfil** (modal): datos básicos, idioma y tema por defecto, **avatar** (recortado y
  reducido a 96×96 en el cliente) y cambio de contraseña (usuarios locales).
- **Modales** centrados reutilizables para los formularios de Usuarios, Instancias y
  Buckets. Iconografía con **lucide-react** (SVG monocromos que heredan el color del tema).
