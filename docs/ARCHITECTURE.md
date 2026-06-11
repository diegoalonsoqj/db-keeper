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
| **Motor de ejecución** | ✅ Etapa 4 | Vuelca cada BD en segundo plano (in-proceso). **PostgreSQL** (`pg_dump`), **MySQL** (`mysqldump`), **MongoDB** (`mongodump`, Atlas/Community) y **SQL Server** (`BACKUP DATABASE` server-side) + subida a GCS. |
| **Programador** | ✅ Etapa 4 | Poller in-proceso (60 s) sobre `core.backup_schedules`; dispara `once`/`recurring` (cron), agnóstico al motor. Barrido de retención cada hora. |
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
core.app_settings (key, value jsonb)   -- 'general' (timezone, idioma) · 'ldap' (config AD) · 'notifications' (correo/Telegram; secretos cifrados)
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
   └─< core.execution_items (id, execution_id, db_name, status, file_name, file_bytes, log,
                             pruned_at, …) >   -- pruned_at: archivo borrado por retención
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
marcan `failed`. Los cuatro motores (PostgreSQL/MySQL/MongoDB/SQL Server), el destino GCS
y el scheduler (poller in-proceso) ya están operativos; la cola (Redis/BullMQ) y el
progreso en tiempo real son fases siguientes.

**Tiempo real** (`modules/backups/events.ts`, Fase A): un bus de eventos in-proceso recibe
del runner el snapshot de la ejecución en cada transición y el endpoint SSE
`GET /api/backups/executions/stream` lo retransmite a los navegadores. La web (*Ejecuciones*)
consume por `EventSource` con *merge* por `id`, *fallback* a *poll* si la conexión cae y
*resync* al reconectar. Con `options.verbose` el motor corre con `--verbose` y su `stderr` se
lee **línea a línea** (`engine/log-lines.ts`); el runner lo agrupa en lotes y lo empuja como
eventos `execution-log` (sin la contraseña) que la web muestra como **consola en vivo** y se
persisten en `execution_items.log`. En *Ejecuciones* el log de cada BD se abre desde un
**botón en la columna Acciones** en un **modal** que streamea en vivo mientras corre y deja el
log final al terminar (auto-scroll). Además, el runner **vigila el tamaño del archivo** de
salida mientras crece (`engine/progress.ts`) y lo empuja como `execution-progress`, de modo que
*Ejecuciones* muestra el **peso creciente** y un **cronómetro** en vivo durante la corrida (útil
en dumps grandes, sin depender de `--verbose`; no aplica a SQL Server). La Fase B (cola BullMQ + Redis pub/sub alimentando el
mismo bus) está diseñada en `REALTIME-QUEUE-DESIGN.md` y aún no implementada.

**Retención** (`modules/backups/retention.ts`): cada evento puede definir
`options.retention = { days, keepLast }`. Un backup exitoso se purga si supera `days` de
antigüedad **o** queda fuera de los últimos `keepLast`; se borra el archivo (local o GCS) y
el ítem se marca con `pruned_at`, conservando el registro para auditoría. Se aplica tras
cada corrida exitosa (vía el runner) y en un **barrido horario** del scheduler (cubre la
expiración por antigüedad de eventos inactivos). SQL Server se omite (el `.bak` no viaja al
servicio).

**Notificaciones** (`modules/notifications/`): al iniciar y al cerrar cada corrida, el
runner dispara `notifyBackup` (fire-and-forget, nunca lanza) que envía por los canales
habilitados según las banderas `notifyOnStart/Success/Failure`. Correo por **SMTP**
(`nodemailer`) o **API HTTP** genérica, y **Telegram** (Bot API; su `parse_mode:HTML` solo
admite `\n` y `<b>`, no `<br>`). La config vive en `app_settings['notifications']` con los
secretos cifrados; `getNotifRuntimeConfig` los descifra solo en el momento del envío.

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
- **Acceso de solo lectura al origen**: DBKeeper **nunca modifica, escribe ni borra datos**
  de las BD que respalda. El **descubrimiento** solo consulta catálogos
  (`pg_database` / `SHOW DATABASES` / `listDatabases` / `sys.databases`) y los **dumps**
  son de solo lectura: `pg_dump --serializable-deferrable`, `mysqldump --single-transaction`
  (sin `--master-data`/`--flush-logs`, no rota binlogs) y `mongodump`. Escribe solo en su
  **propia** BD (catálogo `core.*`, auditoría) y en el **destino** del backup (disco local o
  bucket). **Excepción SQL Server**: `BACKUP DATABASE` no toca los datos de usuario, pero a
  nivel servidor escribe el `.bak` en disco (con `WITH FORMAT, INIT` sobrescribe ese archivo
  si existía), registra el historial en `msdb` y actualiza la base diferencial/LSN (no trunca
  el log); `RESTORE VERIFYONLY` solo verifica.
- **Menor privilegio del usuario de backup**: para PostgreSQL/MySQL/MongoDB basta una
  credencial **de solo lectura**. SQL Server requiere `db_backupoperator` (el mínimo para
  respaldar; evita `sysadmin`).

## Configuración (12-factor)

El `.env` se mantiene **mínimo** (solo el arranque): clave de app, clave maestra de
cifrado, `DATABASE_URL`, `REDIS_URL` y logging. La configuración de LDAP está hoy en
`.env` de forma temporal y migrará al **módulo Settings** (BD) en la Etapa 2.
Validación estricta con Zod al arrancar (falla rápido si algo falta).

## Despliegue (un solo puerto)

En producción la **API sirve también el build estático del front**: con `SERVE_WEB=true`,
Express monta `express.static(WEB_DIST_PATH)` y un *fallback* SPA que devuelve `index.html`
para cualquier `GET` que no empiece por `/api` (el enrutado lo resuelve React Router). Así
toda la app vive en un único puerto (`APP_PORT`), sin Nginx ni segundo proceso. En **dev** se
ignora: Vite corre aparte en `:5173` con proxy `/api`.

- `WEB_DIST_PATH` se resuelve **relativo a `apps/api`** (cwd de `pnpm start`); el default
  `../web/dist` apunta a `apps/web/dist`.
- **Orden de build (monorepo):** `@dbkeeper/api` y `@dbkeeper/web` dependen de
  `@dbkeeper/shared`, que expone sus tipos desde `packages/shared/dist`. Construir un paquete
  suelto en un checkout limpio falla con `Cannot find module '@dbkeeper/shared'`; usar siempre
  `pnpm -r build` (orden topológico: shared → api → web). Detalle operativo en el README.
- **Cookie de sesión sobre HTTP:** la cookie es `secure` por defecto en producción, lo que la
  hace inválida sobre HTTP plano (sesión no persiste → 401 tras el login). Para despliegue
  interno sin TLS, `COOKIE_SECURE=false` desacopla ese flag de `APP_ENV`.

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
