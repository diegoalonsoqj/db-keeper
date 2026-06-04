# Referencia de la API

Base: `/api`. Todas las respuestas usan el sobre uniforme
`{ ok: true, data }` o `{ ok: false, error: { code, message, details? } }`.

La autenticación es por **cookie de sesión** (`dbk_session`, httpOnly). Las rutas
protegidas requieren sesión válida; muchas requieren además un **permiso** concreto.

## Salud

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | — | Liveness. |
| GET | `/ready` | — | Readiness (verifica la BD). |

## Auth — `/api/auth`

| Método | Ruta | Auth | Permiso | Descripción |
|---|---|---|---|---|
| POST | `/login` | — | — | Inicia sesión (`{ username, password }`); setea la cookie. |
| POST | `/logout` | ✅ | — | Cierra sesión; limpia la cookie. |
| GET | `/me` | ✅ | — | Identidad actual (`{ user, permissions }`). |

## Usuarios — `/api/users`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `users:read` | Lista usuarios. |
| GET | `/:id` | `users:read` | Detalle de un usuario. |
| POST | `/` | `users:write` | Crea usuario (local con contraseña, o AD). |
| PATCH | `/:id` | `users:write` | Actualiza datos, estado, contraseña y roles. |
| DELETE | `/:id` | `users:delete` | Elimina (no permite auto-eliminarse). |

Cuerpo de creación:

```jsonc
{
  "username": "jperez",
  "authType": "local",          // "local" | "ad"
  "email": "jperez@empresa.com",
  "fullName": "Juan Pérez",
  "password": "min 8 chars",     // solo authType=local
  "isActive": true,
  "roleKeys": ["operator"]
}
```

## Roles y permisos — `/api/roles`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `roles:read` | Lista roles con sus permisos. |
| POST | `/` | `roles:write` | Crea un rol (`{ key, name, description, permissions }`). |
| PATCH | `/:id` | `roles:write` | Edita nombre/descripción y/o permisos. |
| DELETE | `/:id` | `roles:write` | Elimina (no permite roles de sistema). |

> Los permisos del rol `superadmin` no se pueden modificar.

## Catálogo de permisos — `/api/permissions`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `roles:read` | Catálogo de permisos disponibles (para la matriz). |

## Auditoría — `/api/audit`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `audit:read` | Lista paginada. Query: `limit` (1–200), `offset`, `userId`, `action`. |

## Instancias — `/api/servers`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `servers:read` | Lista instancias (nunca expone la contraseña). |
| GET | `/:id` | `servers:read` | Detalle de una instancia. |
| POST | `/` | `servers:write` | Crea instancia + credencial. |
| PATCH | `/:id` | `servers:write` | Actualiza datos y/o credencial. |
| DELETE | `/:id` | `servers:delete` | Elimina (cascada a su credencial). |

Cuerpo de creación:

```jsonc
{
  "name": "PG Prod",
  "engine": "postgres",          // postgres | mysql | sqlserver | mongo
  "host": "db.prod.local",
  "port": 5432,
  "environment": "produccion",
  "useSsl": true,
  "isCloudSql": false,            // true habilita gcpProject/gcpInstance
  "credential": { "username": "backup_user", "password": "…", "extra": {} }
}
```

En `PATCH`, si `credential.password` se omite, se conserva la contraseña actual.

## Buckets — `/api/buckets`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `servers:read` | Lista buckets (nunca expone la clave de servicio). |
| POST | `/` | `servers:write` | Crea bucket (`{ name, bucket, prefix?, isActive?, serviceAccount? }`). |
| PATCH | `/:id` | `servers:write` | Actualiza; `serviceAccount` vacío borra la clave. |
| DELETE | `/:id` | `servers:delete` | Elimina. |

## Configuración — `/api/settings`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `settings:read` | Configuración general + LDAP (sin contraseña de bind). |
| PATCH | `/general` | `settings:write` | Zona horaria, idioma por defecto. |
| PATCH | `/ldap` | `settings:write` | Config de AD/LDAP. `bindPassword` se cifra; `""` la borra. |

## Catálogo de permisos (`recurso:acción`)

| Categoría | Permisos |
|---|---|
| `users` | `users:read`, `users:write`, `users:delete` |
| `roles` | `roles:read`, `roles:write` |
| `servers` | `servers:read`, `servers:write`, `servers:delete` *(Etapa 2)* |
| `backups` | `backups:read`, `backups:run`, `backups:schedule` *(Etapa 4+)* |
| `settings` | `settings:read`, `settings:write` *(Etapa 2)* |
| `audit` | `audit:read` |

## Códigos de error

| `code` | HTTP | Significado |
|---|---|---|
| `BAD_REQUEST` | 400 | Entrada inválida (regla de negocio). |
| `VALIDATION_ERROR` | 400 | Falla de validación Zod (`details` con los issues). |
| `UNAUTHORIZED` | 401 | Sin sesión o sesión inválida. |
| `FORBIDDEN` | 403 | Faltan permisos / acción no permitida. |
| `NOT_FOUND` | 404 | Recurso inexistente. |
| `CONFLICT` | 409 | Conflicto (p. ej. nombre/clave duplicada). |
| `INTERNAL_ERROR` | 500 | Error no controlado. |
