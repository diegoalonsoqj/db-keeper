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
| PATCH | `/profile` | ✅ | — | Actualiza el perfil propio: `fullName`, `email`, `preferredLanguage`, `preferredTheme`, `avatar` (data URL; `""`/`null` lo borra). |
| POST | `/change-password` | ✅ | — | Cambia la contraseña propia (`{ currentPassword, newPassword }`); solo usuarios locales. |

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
| GET | `/` | `servers:read` | Lista instancias (incluye `credentialId`/`credentialName`). |
| GET | `/:id` | `servers:read` | Detalle de una instancia. |
| POST | `/` | `servers:write` | Crea instancia; referencia una credencial del catálogo. |
| PATCH | `/:id` | `servers:write` | Actualiza datos y/o la credencial referenciada. |
| DELETE | `/:id` | `servers:delete` | Elimina la instancia (no borra la credencial del catálogo). |

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
  "credentialId": "uuid | null"  // credencial del catálogo (opcional, ver /api/credentials)
}
```

La credencial ya no se embebe en la instancia: se gestiona en el **catálogo**
(`/api/credentials`) y se referencia por `credentialId`. Si la credencial indicada no
existe, la API responde `400`.

### Descubrimiento de BDs de una instancia — `/api/servers/:id/databases`

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| POST | `/discover` | `servers:read` | Conecta en vivo y devuelve los nombres de las bases reales (`string[]`, sin las del sistema). `400` si no hay credencial o falla la conexión. Motores: PostgreSQL, MySQL, SQL Server y Mongo. |

> La selección efectiva de BDs vive en el **evento de backup** (`/api/backups`), no en
> la instancia.

## Eventos de backup — `/api/backups`

Un evento define qué respaldar (instancia + credencial + BDs + método + destino). Cada
corrida genera una **ejecución** con su identificador, estado y un detalle por BD.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `backups:read` | Lista eventos (paginado). |
| GET | `/executions` | `backups:read` | Historial de ejecuciones (paginado; `?jobId` opcional). |
| GET | `/:id` | `backups:read` | Detalle de un evento. |
| POST | `/` | `backups:schedule` | Crea un evento. |
| PATCH | `/:id` | `backups:schedule` | Edita un evento. |
| DELETE | `/:id` | `backups:schedule` | Elimina un evento. |
| POST | `/:id/run` | `backups:run` | Lo lanza ahora: crea la ejecución (`pending`) con un ítem por BD y **dispara el motor en segundo plano** (el estado avanza a `running`→`success`/`failed`). |
| POST | `/executions/:execId/retry` | `backups:run` | Reintenta una ejecución: nueva corrida del mismo evento con las mismas BDs. |
| GET | `/executions/:execId/items/:itemId/download` | `backups:read` | Descarga el archivo de backup de esa BD. |

Cuerpo de creación:

```jsonc
{
  "name": "Backup nocturno PG Prod",
  "serverId": "uuid",
  "credentialId": "uuid | null",   // null = usar la credencial de la instancia
  "method": "dump",                 // dump | gcloud (gcloud exige bucketId)
  "bucketId": "uuid | null",
  "databases": ["app", "reporting"],
  "options": {                      // opciones del motor (dump)
    "compress": true,               // true → .sql.gz (gzip); false → .sql plano
    "excludeTables": ["audit.log"]  // patrones --exclude-table (opcional)
  },
  "isActive": true
}
```

> **Ambiente**: el evento **consolida** el ambiente desde la instancia y la credencial
> efectiva. La API valida que coincidan (`400` si difieren) y guarda el código en
> `environment` (no se envía desde el cliente); ese código se usa en el nombre del dump.

> **Motor**: hoy solo **PostgreSQL** (`pg_dump`). Genera
> `{db}_{ambiente}_{timestamp}.sql[.gz]`, valida la integridad del `.gz` y registra
> peso/log por BD. Método **`dump`** → guarda en el destino **local** por defecto.
> Método **`gcloud`** → genera local (staging) y **sube al bucket** con el SDK de GCS
> (service account del destino, en memoria); el ítem guarda la URI `gs://…`. La descarga
> sirve archivos locales o por *streaming* desde GCS. Resto de motores: fases siguientes.

## Ambientes — `/api/environments`

Catálogo de ambientes que alimenta el selector de la instancia. Cada ambiente tiene
**nombre** (etiqueta), **código** (PRD/UAT/…, mayúsculas, único ci), descripción y
estado. El selector muestra `Nombre (CÓDIGO)` y la instancia guarda el **código** como
texto (sin FK); ese código se usa en el nombre del backup. Reutiliza permisos de
instancias.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `servers:read` | Lista ambientes (paginado). |
| POST | `/` | `servers:write` | Crea un ambiente (`name` y `code` únicos, ci). |
| PATCH | `/:id` | `servers:write` | Edita un ambiente. |
| DELETE | `/:id` | `servers:delete` | Elimina; falla si alguna instancia lo usa. |

## Credenciales — `/api/credentials`

Catálogo de credenciales reutilizables (un "usuario de backups" se define una vez y se
asigna a varias instancias). Nunca expone la contraseña ni los datos `extra`.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `servers:read` | Lista credenciales (sin secretos; `hasExtra` indica si hay `extra`). |
| GET | `/:id` | `servers:read` | Detalle de una credencial. |
| POST | `/` | `servers:write` | Crea credencial (`password` obligatoria). |
| PATCH | `/:id` | `servers:write` | Actualiza; `password`/`extra` vacíos conservan los actuales. |
| DELETE | `/:id` | `servers:delete` | Elimina; `409` si está en uso por alguna instancia. |

Cuerpo de creación:

```jsonc
{
  "name": "Backups Prod",
  "username": "backup_user",
  "password": "…",
  "environment": "PRD",                    // opcional; código del catálogo de ambientes
  "description": "Usuario de solo lectura para backups",
  "extra": { "type": "service_account" }   // opcional; JSON cifrado (p. ej. clave GCP)
}
```

En `PATCH`, **omitir un campo = no tocarlo**; enviar `null` lo borra (aplica a
`extra`, `environment`, `description`). Omitir `password` conserva la actual.

## Cuentas de servicio — `/api/cloud-credentials`

Credenciales de nube reutilizables. Cada una tiene `provider` (gcp/aws/azure; hoy solo GCP
funcional), el secreto **cifrado** (nunca se expone) y `metadata` no secreta (GCP:
`clientEmail`/`projectId`). Default **por proveedor**. Reutiliza permisos de instancias.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `servers:read` | Lista cuentas (sin el secreto). |
| POST | `/` | `servers:write` | Crea (`{ name, provider, secret, isActive? }`). |
| PATCH | `/:id` | `servers:write` | Actualiza; `secret` vacío conserva el actual. |
| POST | `/:id/default` | `servers:write` | Marca la cuenta por defecto de su proveedor. |
| DELETE | `/:id` | `servers:delete` | Elimina; `409` si está en uso por un destino. |

## Almacenamiento — `/api/storage`

Destinos de backup: `type` **local** (con `path`) o **gcs** (`bucket`/`prefix` + clave de
servicio cifrada). Un destino por defecto por tipo (`isDefault`). El motor escribe en el
`path` del destino local por defecto (`BACKUP_DIR` es solo fallback).

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `servers:read` | Lista destinos (nunca expone la clave de servicio). |
| POST | `/` | `servers:write` | Crea destino (`{ type: local\|bucket, name, path? \| (provider, bucket, prefix?, cloudCredentialId?), isActive? }`). |
| PATCH | `/:id` | `servers:write` | Actualiza (mismos campos que crear). |
| POST | `/:id/default` | `servers:write` | Marca el destino como por defecto de su tipo. |
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
