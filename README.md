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
  api/        # Express + TS (rutas → servicios → repositorios)
  web/        # React + Vite
packages/
  shared/     # Tipos y contratos compartidos
```

## Requisitos

- Node.js 20+ (probado en 24)
- pnpm 9+  ·  PostgreSQL 16+  ·  Redis (a partir de la Etapa 4)

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # completa DBKEEPER_MASTER_KEY, DATABASE_URL, etc.
pnpm migrate                # aplica las migraciones SQL versionadas
pnpm dev                    # levanta API (:3001) y Web (:5173) en paralelo
```

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

## Estado: desarrollo por etapas

- [x] **Etapa 0** — Fundaciones (monorepo, API base, Web base, migraciones, esquemas).
- [ ] **Etapa 1** — Auth (local + AD/LDAP), Usuarios, Roles/Permisos, auditoría base.
- [ ] **Etapa 2** — Instancias, credenciales cifradas, buckets, módulo Settings.
- [ ] **Etapa 3** — Descubrimiento de instancias → selección de BDs.
- [ ] **Etapa 4** — Motor de ejecución (método `dump`) + cola + evento de backup multi-BD.
- [ ] **Etapa 5** — Tiempo real (progreso + consola en vivo).
- [ ] **Etapa 6** — Programación (scheduler).
- [ ] **Etapa 7** — Notificaciones (Email + Telegram).
- [ ] **Etapa 8** — GCS + `gcloud` + adaptador SQL Server.
- [ ] **Etapa 9** — Retención, auditoría completa, hardening.

## Licencia

CC BY-NC 4.0 — ver [`LICENSE`](./LICENSE).
