# DBKeeper

Sistema centralizado para la **generación, programación y monitoreo de backups** de bases de datos (PostgreSQL, MySQL, MongoDB, SQL Server), a demanda o programados, con almacenamiento local o en la nube (GCS), panel de monitoreo y **notificaciones** por correo (SMTP/API) y Telegram. El seguimiento en tiempo real está en el roadmap.

> Especificación funcional completa: [`DBKeeper-Especificaciones.md`](./DBKeeper-Especificaciones.md).

## Stack

- **Monorepo** con [pnpm workspaces](https://pnpm.io/workspaces) + **TypeScript**.
- **API:** Node.js + Express 5 (estructura en capas).
- **Web:** React + Vite + i18n (`es-419`, `en`), iconos `lucide-react`, tema claro/oscuro.
- **BD de metadatos:** PostgreSQL 16+.
- **Motor de backup:** binarios nativos (`pg_dump`…) lanzados in-proceso; subida a nube con SDK (`@google-cloud/storage`).
- **Cola / tiempo real (planeado):** Redis + BullMQ; hoy el motor y el scheduler corren in-proceso.

```
apps/
  api/                      # Express + TS (rutas → servicios → repositorios)
    migrations/             # SQL versionado (0001_init_schemas, 0002_auth_audit, …)
    src/
      config/               # env (Zod), logger (pino)
      db/                   # pool, runner de migraciones, seed
      lib/                  # password (scrypt), jwt (jose), http-error, respond
      middleware/           # error-handler, auth (authenticate + authorize)
      modules/              # auth · users · roles · permissions · audit · servers · environments · credentials ·
                            #   cloud-credentials · storage · backups (engine + scheduler) · notifications · dashboard · settings
  web/                      # React + Vite
    src/
      auth/                 # AuthContext + guards
      theme/                # ThemeContext (claro/oscuro)
      components/           # layout, modal, menú de usuario, perfil
      pages/                # login y módulos
      lib/                  # cliente API, avatar
      i18n/                 # es-419 · en
packages/
  shared/                   # Tipos y contratos compartidos (enums, RBAC, DTOs)
```

## Documentación

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — componentes, capas, esquemas de BD y modelo de seguridad.
- [`docs/API.md`](./docs/API.md) — referencia de endpoints y permisos requeridos.
- [`CHANGELOG.md`](./CHANGELOG.md) — avances por etapa.
- [`DBKeeper-Especificaciones.md`](./DBKeeper-Especificaciones.md) — especificación funcional.

## Requisitos

- Node.js 20+ (probado en 24)
- pnpm 9+  ·  PostgreSQL 16+
- Cliente nativo del motor a respaldar, en la máquina de la API: `pg_dump` (PostgreSQL),
  `mysqldump` (MySQL), `mongodump` (MongoDB). **SQL Server** no requiere cliente externo
  (usa el driver `mssql` y respalda en una ruta de la propia instancia).
- Redis: planeado para cola/tiempo real; **aún no requerido**

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # completa DBKEEPER_MASTER_KEY, DATABASE_URL, etc.
pnpm migrate                # aplica las migraciones SQL versionadas
pnpm --filter @dbkeeper/api seed   # siembra permisos, roles y el superadmin inicial
pnpm dev                    # levanta API (APP_PORT) y Web (:5173) en paralelo
```

El primer login usa el superadmin sembrado (`BOOTSTRAP_ADMIN_USERNAME`, por defecto `admin`).
Si no defines `BOOTSTRAP_ADMIN_PASSWORD`, el seed imprime una contraseña temporal en consola.

Generar la clave maestra de cifrado:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Scripts

| Comando | Acción |
|---|---|
| `pnpm dev` | API + Web en paralelo |
| `pnpm dev:api` / `pnpm dev:web` | Solo un servicio |
| `pnpm build` | Compila todos los paquetes |
| `pnpm typecheck` | Chequeo de tipos en todo el monorepo |
| `pnpm migrate` | Aplica migraciones pendientes |
| `pnpm --filter @dbkeeper/api seed` | Siembra permisos, roles de sistema y superadmin |

## Autenticación y roles

Login con usuarios **locales** (hash scrypt) y de **Active Directory** (LDAP/LDAPS).
La sesión viaja en una cookie httpOnly (JWT). El control de acceso es **RBAC granular**:
cada rol tiene un conjunto de permisos (`recurso:acción`) **editable** desde el módulo
de Roles y Permisos. Roles de sistema sembrados:

| Rol | Por defecto |
|---|---|
| `superadmin` | Todos los permisos (no editable, no eliminable) |
| `admin` | Usuarios, instancias, backups, settings y auditoría |
| `editor` | Configura y ejecuta/programa backups |
| `operator` | Ejecuta backups a demanda |
| `viewer` | Solo lectura |

Toda acción relevante queda registrada en la **auditoría** (`audit.activity_log`).

## Interfaz

- **Panel** con KPIs (instancias, eventos, ejecuciones/éxito/peso de 7 días), últimas
  ejecuciones, próximas programaciones y estado de API/BD.
- **Tema claro/oscuro** con preferencia por usuario y respeto al sistema.
- **Barra lateral contraíble** (riel de iconos) con logo de marca.
- **Menú de usuario** con avatar, cambio de idioma, *Ver mi perfil* y cerrar sesión.
- **Perfil**: editar datos, idioma/tema por defecto, avatar y contraseña (usuarios locales).
- Formularios de alta/edición en **modales** centrados; iconografía `lucide-react`.
- **Avisos propios**: notificaciones *toast* (éxito/error) y diálogo de confirmación
  custom (sin `alert`/`confirm` nativos del navegador).
- **Notificaciones de backups**: configuración en *Settings* de correo (SMTP o API HTTP) y
  Telegram, con eventos a notificar (inicio/éxito/fallo) y botón *probar envío*.
- **Configuración por secciones**: la página *Settings* usa un **menú lateral fijo**
  (General · Almacenamiento · LDAP · Notificaciones) con los campos en una rejilla de 2
  columnas; responsive en pantallas angostas.

## Estado: desarrollo por etapas

- [x] **Etapa 0** — Fundaciones (monorepo, API base, Web base, migraciones, esquemas).
- [x] **Etapa 1** — Auth (local + AD/LDAP), Usuarios, Roles/Permisos, auditoría base.
- [x] **Etapa 2** — Instancias, credenciales cifradas, almacenamiento, módulo Settings.
- [x] **Etapa 3** — Catálogo de credenciales reutilizables ✅; descubrimiento de
  instancias → selección de BDs ✅.
- [~] **Etapa 4** — Backups. **Vertical PostgreSQL completo**; el resto de motores
  reutiliza esta misma maquinaria (solo falta su dumper):
  - [x] Evento de backup multi-BD + *Ejecutar ahora*.
  - [x] Motores reales: **PostgreSQL** (`pg_dump`), **MySQL** (`mysqldump` + limpieza
    `DEFINER`), **MongoDB** (`mongodump`, Atlas SRV / Community) y **SQL Server**
    (`BACKUP DATABASE` a ruta de la instancia + `RESTORE VERIFYONLY`).
  - [x] *Ejecuciones*: estado/fin/duración/peso, **log**, **descarga** y **reintento**.
  - [x] **Ambientes** (código + nombre) y consistencia instancia/credencial en el evento.
  - [x] **Almacenamiento** local + **bucket** multi-nube (subida a **GCS** por SDK).
  - [x] **Cuentas de servicio** de nube (multi-proveedor; GCP funcional).
  - [x] **Scheduler** (agendar única / recurrente por cron), poller in-proceso.
  - [x] **Notificaciones** de backup por **correo** (SMTP/API) y **Telegram** (inicio/
    éxito/fallo), con envío de prueba; enganchadas al runner.
  - [x] **Retención** por evento (antigüedad y/o cantidad): purga el archivo (local/GCS)
    conservando el registro; barrido tras cada corrida y horario en el scheduler.
  - [x] **Tiempo real (SSE, Fase A)**: progreso de ejecuciones en vivo por
    `EventSource`, con fallback a poll, **consola en vivo** (`--verbose` por evento)
    en un **modal de log por BD**, y **progreso por tamaño + cronómetro** del dump en
    curso (útil para BD grandes). Diseño en `docs/REALTIME-QUEUE-DESIGN.md`.
  - [ ] AWS/Azure funcionales (estructura ya lista; hoy solo GCP).

  > **Solo lectura del origen:** DBKeeper nunca modifica, escribe ni borra datos de las BD que
  > respalda (descubrimiento por catálogos; dumps de solo lectura). Solo escribe en su propia
  > BD (catálogo/auditoría) y en el destino del backup. **Excepción** SQL Server: `BACKUP
  > DATABASE` no toca los datos de usuario, pero a nivel servidor escribe el `.bak`, el
  > historial en `msdb` y la base diferencial. Detalle en `docs/ARCHITECTURE.md`.
- [ ] **Etapa 5** — Tiempo real Fase B: cola (Redis/BullMQ) + consola en vivo.
- [ ] **Etapa 9** — Auditoría completa, hardening.

## Licencia

CC BY-NC 4.0 — ver [`LICENSE`](./LICENSE).
