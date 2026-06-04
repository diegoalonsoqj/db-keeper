# Changelog

Avances de DBKeeper, organizados por etapa de desarrollo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

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
