# DBKeeper

Sistema centralizado para la **generación, programación y monitoreo de backups** de bases de datos (PostgreSQL, MySQL, MongoDB, SQL Server), con backups a demanda o programados, seguimiento en tiempo real y notificaciones.

> Especificación funcional completa: [`DBKeeper-Especificaciones.md`](./DBKeeper-Especificaciones.md).

## Stack

- **Monorepo** con [pnpm workspaces](https://pnpm.io/workspaces) + **TypeScript**.
- **API:** Node.js + Express 5 (estructura en capas).
- **Web:** React + Vite + i18n (`es-419`, `en`).
- **BD de metadatos:** PostgreSQL 16+.
- **Cola / tiempo real (desde Etapa 4):** Redis + BullMQ.

```
apps/
  api/                      # Express + TS (rutas → servicios → repositorios)
    migrations/             # SQL versionado (0001_init_schemas, 0002_auth_audit, …)
    src/
      config/               # env (Zod), logger (pino)
      db/                   # pool, runner de migraciones, seed
      lib/                  # password (scrypt), jwt (jose), http-error, respond
      middleware/           # error-handler, auth (authenticate + authorize)
      modules/              # auth · users · roles · permissions · audit · servers · buckets · settings
  web/                      # React + Vite
    src/
      auth/                 # AuthContext + guards
      components/ pages/    # layout, login y módulos
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
- pnpm 9+  ·  PostgreSQL 16+  ·  Redis (a partir de la Etapa 4)

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

## Estado: desarrollo por etapas

- [x] **Etapa 0** — Fundaciones (monorepo, API base, Web base, migraciones, esquemas).
- [x] **Etapa 1** — Auth (local + AD/LDAP), Usuarios, Roles/Permisos, auditoría base.
- [x] **Etapa 2** — Instancias, credenciales cifradas, buckets, módulo Settings.
- [ ] **Etapa 3** — Descubrimiento de instancias → selección de BDs.
- [ ] **Etapa 4** — Motor de ejecución (método `dump`) + cola + evento de backup multi-BD.
- [ ] **Etapa 5** — Tiempo real (progreso + consola en vivo).
- [ ] **Etapa 6** — Programación (scheduler).
- [ ] **Etapa 7** — Notificaciones (Email + Telegram).
- [ ] **Etapa 8** — GCS + `gcloud` + adaptador SQL Server.
- [ ] **Etapa 9** — Retención, auditoría completa, hardening.

## Licencia

CC BY-NC 4.0 — ver [`LICENSE`](./LICENSE).
