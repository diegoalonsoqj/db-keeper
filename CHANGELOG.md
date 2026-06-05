# Changelog

Avances de DBKeeper, organizados por etapa de desarrollo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

## [Etapa 4 · parte 2] — Motor real de backup (PostgreSQL) · 2026-06-05

### Añadido
- **Motor de volcado** (`modules/backups/engine/`): al lanzar un evento, un runner
  en segundo plano vuelca cada BD del snapshot y va actualizando los estados
  (`pending`→`running`→`success`/`failed`) con archivo, peso y log por BD.
  - **PostgreSQL** vía `pg_dump -Fp` con los mismos parámetros que el script de
    referencia (`--no-owner --no-privileges --serializable-deferrable`, apto para
    restaurar en Cloud SQL). La compresión es **configurable** por evento
    (`options.compress`, por defecto activada): con gzip genera `.sql.gz`
    (`pg_dump -Z6`, restaurable con `gunzip -c … | psql`) y sin comprimir genera
    `.sql` (restaurable con `psql -f`). Tablas a excluir configurables por evento
    (`options.excludeTables` → `--exclude-table`). La contraseña viaja por
    `PGPASSWORD` (nunca en la línea de comandos ni en logs); los argumentos van como
    array (sin shell, sin inyección).
  - **Nombre de archivo** `{db}_{ambiente}_{timestamp}.sql[.gz]` (el ambiente sale de
    `server.environment`; la carpeta de la ejecución y la extensión ya indican que es
    un backup, así que se omite el prefijo `backup_`).
  - **Validación de integridad**: el `.sql.gz` se verifica descomprimiéndolo entero
    (equivalente a `gunzip -t`) y se rechaza el dump vacío; si pg_dump o la
    validación fallan, se borra el archivo parcial para no dejar dumps inválidos.
  - **Scripts de referencia** (`docs/pg_backup.py`, `docs/mysql_backup.py`,
    `docs/mongo_backup_telegram.py`) que definen los parámetros de dump esperados.
  - Registry de dumpers por motor; el resto (mysql/mongo/sqlserver) y el destino
    **gcloud/GCS** quedan para pasos siguientes (fallan con mensaje claro por ahora).
- **Recuperación de huérfanas** al arrancar: como la ejecución es en-proceso, un
  reinicio marca como `failed` las corridas que quedaron en `pending`/`running`.
- **Frontend**: la página *Ejecuciones* refresca cada 3 s mientras haya corridas
  activas y ahora muestra **fin, duración y peso** (suma de los dumps; peso por BD en
  el detalle).

### Configuración
- Nuevas env: `BACKUP_DIR` (destino local, por defecto `/backups` en la raíz,
  ignorada por git), `PG_DUMP_PATH` (binario), `BACKUP_TIMEOUT_MS` (timeout por BD).

### Nota
- Destino soportado: **disco local**. La subida a bucket GCS (método `gcloud`) y los
  demás motores llegan después; el **scheduler** (agendar/recurrente) es la fase 3.

## [Etapa 4 · parte 1] — Eventos de backup multi-BD y registro de ejecuciones · 2026-06-04

### Añadido
- **Evento de backup** (`core.backup_jobs`, migración `0008`): definición reutilizable
  con instancia, credencial (heredada de la instancia u **override**), método
  (dump/gcloud), destino (bucket) y opciones. Las BDs a respaldar viven en
  `core.backup_job_databases` (**multi-BD**).
- **Ejecuciones**: cada corrida crea una `core.executions` (cabecera con su
  identificador, estado y origen manual/programado) con un `core.execution_items` por
  BD. `POST /api/backups/:id/run` lanza el evento (crea la ejecución en `pending`).
- **API** `/api/backups`: CRUD de eventos, `:id/run` y `GET /executions` (historial).
  Permisos: `backups:read` (ver), `backups:schedule` (gestionar), `backups:run` (ejecutar).
- **Frontend**: módulos *Backups* (tabla + asistente con descubrimiento de BDs) y
  *Ejecuciones* (historial con estado por evento y por BD).

### Cambiado
- El **descubrimiento** de BDs se integra en el asistente del evento; el endpoint en
  vivo queda como `POST /api/servers/:id/databases/discover` (devuelve nombres).

### Eliminado
- La selección de BDs **por instancia** (`core.databases` y su UI), superada por el
  evento de backup (migración `0009` la dropea).

### Nota
- *Fase 1*: `run` deja el registro de ejecución en `pending`; el **motor real** de
  volcado (pg_dump/mysqldump/…, cola y progreso) y el **scheduler** llegan en fases
  siguientes.

## [Etapa 3 · parte 2] — Descubrimiento de instancias → selección de BDs · 2026-06-04

### Añadido
- **`core.databases`** (migración `0007`): bases de datos seleccionadas para
  respaldar por instancia (columna `schemas` reservada para una iteración futura).
- **Descubrimiento en vivo por motor** (`modules/databases/discovery/`): conecta a
  la instancia con su credencial del catálogo y lista sus bases reales, excluyendo
  las del sistema. Soporta **PostgreSQL, MySQL, SQL Server y Mongo** (drivers `pg`,
  `mysql2`, `mssql`, `mongodb`), con timeout de conexión y SSL según la instancia.
- **API** `/api/servers/:id/databases`: `GET` (selección guardada),
  `POST /discover` (lista en vivo marcando las ya elegidas) y `PUT` (guarda la
  selección, auditado).
- **Frontend**: acción *Bases de datos* por instancia que abre un modal con
  *Descubrir*, lista con checkboxes (preselecciona las guardadas) y *Guardar selección*.

### Seguridad
- La credencial se descifra solo en memoria para conectar; el mensaje de error del
  driver se sanea para no filtrar la contraseña.

## [Etapa 3 · parte 1] — Catálogo de credenciales reutilizables · 2026-06-04

### Añadido
- **Catálogo de credenciales** (migración `0005`): `secrets.credentials` deja de ser
  1:1 con la instancia y pasa a ser un catálogo independiente (un "usuario de backups"
  reutilizable). `core.servers` referencia una credencial por `credential_id` (muchas
  instancias a una credencial). La migración convierte las credenciales 1:1 existentes
  al catálogo y las enlaza.
- **Módulo Credenciales** (`/api/credentials`): CRUD del catálogo con contraseña y
  `extra` cifrados (AES-256-GCM); nunca expone la contraseña. Auditoría de altas,
  cambios y bajas.
- **Frontend**: página *Credenciales* (CRUD, campo `extra` como JSON cifrado) y, en
  *Instancias*, un **selector** de credencial del catálogo en vez de capturar
  usuario/contraseña por instancia.

### Cambiado
- **Instancias**: el alta/edición ya no embebe la credencial; usa `credentialId`
  (opcional, se puede asignar luego). `ServerDto` expone `credentialId`/`credentialName`.

### Seguridad
- **Borrado coherente** (migración `0006`): la FK `core.servers.credential_id` pasa a
  `ON DELETE RESTRICT`, alineando la BD con la regla del service (no se borra una
  credencial en uso). El service captura `foreign_key_violation` (23503) y responde
  **409**, cerrando la carrera entre la verificación y el borrado (TOCTOU).

## [UX] — Perfil de usuario, temas y modales · 2026-06-04

### Añadido
- **Perfil de usuario** (migración `0004`): columnas `avatar`, `preferred_language`,
  `preferred_theme` en `auth.users`. Endpoints self-service `PATCH /api/auth/profile`
  y `POST /api/auth/change-password` (solo usuarios locales).
- **Menú de usuario** en el header: avatar + nombre completo y usuario; desplegable
  con *Ver mi perfil*, cambio de idioma y *Cerrar sesión*.
- **Modal de perfil**: cambiar contraseña, idioma y tema por defecto, y subir
  **avatar** (la imagen se recorta y reduce a 96×96 en el cliente antes de guardarse).
- Las **preferencias** de idioma/tema del usuario se aplican al iniciar sesión.
- **Componente Modal** reutilizable; los formularios de crear/editar de Usuarios,
  Instancias y Buckets ahora se muestran en **modales centrados**.

### Cambiado
- Iconos con **lucide-react** (SVG monocromos) en vez de emoji.
- Selector de **tema claro/oscuro** (con preferencia por usuario).
- **Barra lateral contraíble**: logo de marca y botón flotante sobre la divisoria
  para contraer/expandir (riel de iconos al contraer).

## [Etapa 2] — Instancias, credenciales cifradas, buckets y Settings · 2026-06-04

### Añadido
- **Esquema `core`/`secrets`** (migración `0003`): `core.servers` (instancias con
  datos de conexión), `secrets.credentials` (1:1, contraseña/extra cifrados),
  `core.storage_buckets` (destinos GCS) y `core.app_settings` (configuración).
- **Cifrado de secretos** a nivel de aplicación: **AES-256-GCM** (`lib/crypto.ts`)
  con `DBKEEPER_MASTER_KEY`. Contraseñas de instancias, claves de servicio GCP y
  contraseña de bind de LDAP se guardan cifradas y nunca se devuelven en claro.
- **Módulo Instancias** (`/api/servers`): CRUD con credencial embebida; el motor,
  host, puerto, entorno, SSL y flags de Cloud SQL. Selector base para los backups.
- **Módulo Buckets** (`/api/buckets`): CRUD de destinos de almacenamiento GCS.
- **Módulo Settings** (`/api/settings`): configuración general (zona horaria,
  idioma por defecto) y de **AD/LDAP**.
- **LDAP movido a la BD**: la configuración de AD ahora vive en Settings; las
  variables de entorno quedan como *fallback*.
- **Frontend**: páginas de Instancias (CRUD + credenciales), Buckets (CRUD) y
  Settings (general + LDAP), con navegación filtrada por permiso e i18n.

### Seguridad
- Secretos cifrados en reposo (AES-256-GCM); verificado que no aparecen en claro
  en la BD ni en las respuestas de la API.
- La contraseña de bind LDAP no se incluye en la auditoría ni en las respuestas.

## [Etapa 1] — Autenticación, RBAC y auditoría · 2026-06-04

### Añadido
- **Esquema `auth`** (migración `0002`): `users`, `roles`, `permissions`,
  `role_permissions`, `user_roles`; y **`audit.activity_log`**.
- **Seed**: 14 permisos, 5 roles de sistema con permisos por defecto editables y
  un superadmin inicial (bootstrap por variables de entorno).
- **Autenticación**: login local (hash **scrypt** con `node:crypto`) y de
  **Active Directory** vía **LDAP/LDAPS** (`ldapts`, bind-search-bind).
  Sesión **JWT** (`jose`) en **cookie httpOnly**.
- **Autorización RBAC**: middleware `authenticate` + `authorize(permiso)`; los
  permisos se resuelven desde la BD en cada request.
- **Módulos API** en capas (repository → service → routes): `auth`, `users`,
  `roles`, `permissions`, `audit`. Validación con **Zod**.
- **Auditoría** de acciones (login, login fallido, logout, CRUD de usuarios y roles).
- **Frontend**: `AuthContext` + guards (`RequireAuth`, `RequirePermission`),
  cliente API tipado, login, layout con navegación filtrada por permiso, y módulos
  de Usuarios (CRUD + roles), Roles/Permisos (matriz editable) y Auditoría.

### Seguridad
- superadmin con permisos bloqueados; protección contra auto-eliminación de usuario.
- Mensajes de login genéricos (no revelan si el usuario existe).
- Secretos nunca en logs (redacción en pino) ni en respuestas.

### Pendiente / nota
- La configuración de **LDAP** vive temporalmente en `.env`; se moverá al módulo
  **Settings** (BD) en la Etapa 2.

## [Etapa 0] — Fundaciones · 2026-06-04

### Añadido
- **Monorepo** pnpm + TypeScript (`apps/api`, `apps/web`, `packages/shared`).
- **API** Express 5 en capas: config 12-factor validada con Zod, logger pino,
  pool a PostgreSQL 16, runner de migraciones SQL versionadas, esquemas
  `auth`/`core`/`secrets`/`audit` (migración `0001`), endpoints `/api/health` y
  `/api/ready`.
- **Web** React + Vite + i18n (`es-419`/`en`), layout y proxy a la API.
- **Shared**: enums y contratos (roles, motores, estados, `ApiResponse`).
- Tooling: `.env.example`, `.gitignore`, `.gitattributes` (LF), README.
