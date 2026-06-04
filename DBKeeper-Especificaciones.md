# DBKeeper — Especificación del Proyecto

> Sistema centralizado para la generación, programación y monitoreo de backups de bases de datos.

---

## 1. Visión general

DBKeeper es una aplicación que centraliza y automatiza la generación de copias de seguridad (backups) de bases de datos. Hoy estos backups se ejecutan de forma manual mediante scripts de Python independientes; el objetivo de DBKeeper es convertir ese proceso en un sistema unificado con interfaz web, capaz de ejecutar backups **a demanda** o **de forma programada**, mostrar el avance en tiempo real y notificar el resultado por distintos canales.

El sistema soporta múltiples motores de base de datos y dos estrategias de respaldo: el uso de **herramientas de volcado nativas** (`dump`) y la **exportación mediante `gcloud`** para instancias gestionadas en Google Cloud.

## 2. Objetivos

- Reemplazar la ejecución manual de scripts por un flujo controlado desde una interfaz web.
- Permitir backups inmediatos (on-demand) seleccionando servidor y base de datos.
- Permitir backups programados, indicando la hora/frecuencia de ejecución.
- Mostrar progreso en tiempo real (barra de avance + salida de consola).
- Notificar el resultado de cada backup por correo y Telegram.
- Almacenar de forma segura las credenciales y la configuración, manteniendo en el `.env` únicamente lo imprescindible.
- Reaprovechar la lógica de los scripts de Python existentes (Mongo, MySQL, Postgres).

## 3. Alcance funcional

El sistema cubre dos modos de operación y varios motores:

**Modos de ejecución**
- Backup manual / a demanda.
- Backup programado (por hora fija o expresión recurrente).

**Motores soportados**
- Microsoft SQL Server
- MySQL
- PostgreSQL
- MongoDB

Cada motor puede estar **autogestionado** (servidor propio, VM u on-premise) o ser una instancia **gestionada en Google Cloud (Cloud SQL)**.

**Métodos de generación (dos líneas)**
- **Volcado nativo (`dump`):** ejecuta la herramienta de respaldo nativa de cada motor (`mysqldump`, `pg_dump`, `mongodump` y su homólogo en SQL Server, `BACKUP DATABASE`).
- **Exportación con `gcloud`:** usa `gcloud sql export` para instancias gestionadas de Cloud SQL, dejando el archivo en un bucket de Google Cloud Storage.

Cada trabajo de backup elige **una** de estas dos líneas.

## 4. Motores y métodos de backup

> **Principio de fidelidad a los scripts existentes.** Los scripts de Python actuales (`mysql_backup.py`, `pg_backup.py` y, más adelante, el de MongoDB) son la **implementación de referencia** de cómo se generan los backups. DBKeeper debe reproducir esa misma forma de trabajar: las mismas herramientas, los mismos flags de cada comando, los mismos pasos (validación de conexión → volcado → post-proceso como la limpieza de `DEFINER` → compresión → verificación de integridad) y los mismos formatos de salida. El sistema no inventa un método de backup distinto: orquesta, programa y monitorea exactamente el procedimiento que hoy se ejecuta a mano.

La generación de backups se organiza en **dos líneas o métodos**, y cada trabajo de backup usa exactamente uno. Esta distinción es el eje del módulo de ejecución.

### 4.1 Método 1 — Volcado nativo (`dump`)

Ejecuta la herramienta de respaldo nativa de cada motor sobre una conexión directa a la base de datos. Es la línea que replican los scripts actuales. El archivo se genera en la ruta de destino que DBKeeper administra (disco local, NAS o recurso compartido).

| Motor | Herramienta / Comando base | Formato de salida |
|---|---|---|
| MySQL | `mysqldump --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF` | `.sql` → `.sql.gz` |
| PostgreSQL | `pg_dump --verbose --no-owner --no-privileges` (SQL plano canalizado a gzip) | `.sql.gz` / `.sql` |
| MongoDB | `mongodump --archive --gzip` | `.archive` / `.gz` |
| SQL Server | `BACKUP DATABASE ... WITH COMPRESSION, COPY_ONLY, STATS` | `.bak` (compresión nativa) |

Notas del método dump:
- **MySQL, PostgreSQL y MongoDB** transmiten el volcado al proceso que ejecuta el comando, por lo que el archivo se escribe directamente en el almacenamiento de DBKeeper. La compresión se aplica con el flag nativo (`--gzip`) o canalizando la salida a `gzip`.
- **SQL Server se comporta distinto:** `BACKUP DATABASE` escribe el `.bak` en el sistema de archivos del **propio servidor SQL Server**, no en la máquina que lanza el comando (que puede ser remota, por TCP/1433). Por eso este motor requiere una **estrategia de destino/recuperación**: respaldar a un recurso compartido de red (UNC) accesible por ambas partes, o respaldar localmente y copiar el archivo después. La compresión nativa (`WITH COMPRESSION`) está disponible en Standard/Enterprise (no en Web/Express). El avance se obtiene de los mensajes `STATS` en lugar de medir el tamaño del archivo.
- **Compatibilidad con Cloud SQL:** el backup de MySQL elimina las cláusulas `DEFINER=...` antes de comprimir, paso necesario si el dump se restaurará luego en una instancia gestionada.

### 4.2 Método 2 — Exportación con `gcloud`

Usa la API de Cloud SQL (mediante `gcloud sql export`) para que sea la **propia instancia gestionada** la que genere el respaldo y lo deposite en un bucket de Google Cloud Storage. No se conecta a la base ni se transmite el volcado: se invoca una operación de exportación y se monitorea su estado. Requiere que la cuenta de servicio de la instancia tenga permiso de escritura sobre el bucket.

| Motor (Cloud SQL) | Comando base | Destino / Formato |
|---|---|---|
| MySQL / PostgreSQL | `gcloud sql export sql INSTANCIA gs://BUCKET/archivo.sql.gz --database=NOMBRE_BD` | `.sql.gz` en GCS |
| SQL Server | `gcloud sql export bak INSTANCIA gs://BUCKET/archivo.bak --database=NOMBRE_BD` | `.bak` (`.gz` para comprimir) en GCS |

Notas del método gcloud:
- El archivo aterriza en el bucket de GCS, no en una ruta local; la "ubicación" que reporta DBKeeper es la URI `gs://...`.
- Para comprimir, se usa la extensión `.gz` en el archivo de salida.
- En SQL Server admite además backup diferencial (`--bak-type=DIFF`) y exportación de logs de transacciones.
- **No confundir con `gcloud storage cp`.** Este método de *generación* usa `gcloud sql export`, donde la instancia de Cloud SQL produce el archivo directamente en el bucket. Es distinto de **subir a GCS un backup ya generado por el método dump**, lo cual se hace con `gcloud storage cp` y es una opción de **destino de almacenamiento** (ver Sección 12), no un método de generación. El script de MongoDB usa esta segunda forma: genera con `mongodump` y luego archiva en el bucket.

### 4.3 Principio común a ambos métodos

En las dos líneas, DBKeeper aplica la misma orquestación: validación previa, ejecución monitoreada (progreso + consola), registro del resultado (inicio, fin, duración, archivo, ubicación, peso) y notificaciones. Lo que cambia es **dónde se genera el archivo** (lado de DBKeeper en el método dump; bucket de GCS en el método gcloud) y **de dónde sale el progreso** (consola / `STATS` vs. estado de la operación de Cloud SQL).

La lógica de los scripts de Python actuales (MySQL, Postgres y MongoDB) corresponde al **método dump** y se integra como **adaptadores por motor**, con la interfaz común descrita en el **Anexo A**.

## 5. Arquitectura del sistema

DBKeeper se organiza en componentes desacoplados para separar la interfaz, la orquestación y la ejecución de las tareas pesadas de backup.

### 5.1 Componentes

- **Frontend (SPA web):** interfaz donde el usuario configura servidores y bases, lanza backups manuales, programa backups y visualiza el progreso y el historial.
- **API / Backend:** expone los endpoints REST, gestiona la configuración, encola las tareas de backup y transmite el progreso al frontend.
- **Worker de ejecución:** proceso que realmente ejecuta el backup (lanza `mysqldump`, `pg_dump`, `gcloud`, etc.), captura la salida de consola y reporta el avance. Permite ejecutar backups largos sin bloquear la API.
- **Programador (Scheduler):** dispara las tareas programadas en la hora/frecuencia configurada.
- **Base de datos de metadatos:** almacena servidores, bases, trabajos, programaciones, historial de ejecuciones, canales de notificación y credenciales cifradas.
- **Almacenamiento de backups:** la ruta de destino donde se guardan los archivos (disco local/NAS, o bucket de GCS para el caso `gcloud`).

### 5.2 Stack tecnológico recomendado

Esta es una propuesta coherente con los scripts en Python existentes; cualquier pieza puede ajustarse según preferencias del equipo.

| Componente | Tecnología recomendada | Motivo |
|---|---|---|
| Backend / API | **FastAPI** (Python) | Asíncrono, soporta streaming (WebSocket/SSE), reutiliza el código Python actual |
| Cola de tareas y ejecución | **Celery + Redis** | Maneja backups largos, reintentos y estados de progreso |
| Programador | **Celery Beat** (alternativa: APScheduler) | Disparo de tareas por cron/hora |
| Frontend | **React** | Componentes para barra de progreso, consola en vivo y alertas |
| Tiempo real | **WebSocket o SSE** | Empuja progreso y salida de consola al navegador |
| BD de metadatos | **PostgreSQL** | Soporta múltiples esquemas y cifrado a nivel de columna (pgcrypto) |
| Cifrado de secretos | **cryptography (Fernet)** o **pgcrypto** | Cifra credenciales sensibles en la BD |
| Notificaciones | **SMTP** + **Telegram Bot API** | Correo y Telegram |

### 5.3 Flujo de ejecución de un backup

1. El usuario lanza un backup (manual) o el programador lo dispara (programado).
2. La API crea un registro de **ejecución** en estado `pendiente` y encola la tarea en el worker.
3. El worker pasa el registro a `en ejecución`, descifra las credenciales del servidor destino y lanza el comando del motor correspondiente.
4. Mientras corre, el worker captura la salida de consola línea por línea y publica el progreso (porcentaje + líneas de log) a un canal de tiempo real.
5. La API reenvía esos eventos al frontend vía WebSocket/SSE, que actualiza la barra de progreso y la consola.
6. Al finalizar, el worker registra estado (`éxito`/`fallo`), hora de inicio/fin, duración, archivo, ruta y peso, y dispara las notificaciones configuradas.

## 6. Modos de ejecución

### 6.1 Backup manual (a demanda)

El usuario selecciona en la interfaz el **servidor** y la **base de datos** a respaldar, revisa las opciones (método, formato, ruta de destino) y ejecuta el backup de inmediato. El avance se muestra en pantalla en tiempo real.

### 6.2 Backup programado

El usuario deja toda la configuración guardada (servidor, base, método, ruta, opciones) y define una **hora de inicio** o una **frecuencia** (por ejemplo, diaria a las 02:00). El programador dispara la tarea automáticamente en el momento indicado. Cada ejecución programada queda igualmente registrada en el historial y puede notificar su resultado.

Parámetros de programación sugeridos: hora de inicio, frecuencia (única, diaria, semanal, mensual o expresión cron), zona horaria y estado (activa/inactiva).

## 7. Seguimiento en tiempo real

La interfaz debe reflejar el estado del backup mientras se ejecuta:

- **Barra de progreso:** muestra el porcentaje de avance del backup en curso.
- **Salida de consola:** imprime parte de la verbosidad de las herramientas (`mysqldump`, `pg_dump`, etc.) para que el usuario vea qué está ocurriendo. Se transmite línea por línea desde el worker.
- **Alerta de finalización:** al terminar, la interfaz muestra una alerta/notificación indicando que el backup concluyó (éxito o error).

> Nota técnica sobre el progreso: algunas herramientas de dump no reportan un porcentaje exacto. Para esos casos el progreso puede estimarse por etapas (conexión → volcado → compresión → escritura del archivo) o por tamaño escrito frente a un tamaño estimado, y complementarse con la salida de consola en vivo.

## 8. Notificaciones

Cuando un backup finaliza, el sistema puede notificar por uno o varios canales. Los canales son configurables y se asocian a cada trabajo.

**Canales soportados:**
- **Correo electrónico** (SMTP).
- **Telegram** (Bot API).

**Información incluida en cada notificación:**
- Nombre del servidor y base de datos.
- Estado final (éxito / error).
- Hora de inicio.
- Hora de fin.
- Duración total.
- Nombre del archivo generado.
- Ubicación / ruta (o bucket de GCS).
- Peso del archivo.

## 9. Gestión de configuración y secretos

Principio rector: **el `.env` contiene solo lo mínimo indispensable para arrancar la aplicación**; todo lo demás (credenciales de los servidores destino, configuración de notificaciones, programaciones, etc.) se guarda en tablas de la base de datos, con los datos sensibles cifrados.

La razón es práctica: la aplicación necesita un conjunto mínimo de datos para poder conectarse a su propia base de datos y descifrar el resto de secretos. Ese conjunto mínimo vive en el `.env`; a partir de ahí, DBKeeper lee la configuración desde la BD.

**Qué vive en el `.env` (bootstrap mínimo):**
- Clave maestra de cifrado (para descifrar los secretos guardados en BD).
- Cadena de conexión a la base de datos de metadatos.
- URL del broker de tareas (Redis).
- Clave secreta de la aplicación (firma de sesiones/tokens).
- Entorno de ejecución.

**Qué vive en la base de datos (cifrado cuando es sensible):**
- Servidores y sus credenciales (usuario, contraseña, host, puerto).
- Configuración de notificaciones (credenciales SMTP, token del bot de Telegram, destinatarios).
- Credenciales / clave de servicio de `gcloud` para Cloud SQL.
- Trabajos de backup, programaciones e historial de ejecuciones.

## 10. Seguridad y cifrado

### 10.1 Cifrado de datos sensibles

Las tablas y/o campos que contengan información sensible (contraseñas de bases de datos, cadenas de conexión, token del bot de Telegram, credenciales SMTP, claves de servicio de GCP) deben almacenarse **cifrados**.

Estrategia recomendada:
- Cifrado simétrico a nivel de aplicación con **Fernet** (librería `cryptography`): los campos sensibles se cifran antes de guardarse y se descifran en memoria al usarse. La clave maestra es el único secreto de cifrado y reside en el `.env`.
- Alternativa a nivel de base de datos: extensión **pgcrypto** de PostgreSQL para cifrar columnas directamente en la BD.

En ningún caso las credenciales de los servidores destino deben guardarse en texto plano ni quedar registradas en los logs o en las notificaciones.

### 10.2 Uso de múltiples esquemas en PostgreSQL

Cuando sea necesario, la base de datos de metadatos puede organizarse en más de un esquema de PostgreSQL para separar responsabilidades y aislar la información sensible. Propuesta de esquemas:

- `core` — entidades operativas: servidores, bases, trabajos, programaciones y ejecuciones.
- `secrets` (o `vault`) — credenciales y secretos cifrados, aislados del resto.
- `audit` — registro de auditoría de acciones.

Aislar los secretos en su propio esquema permite aplicar permisos y políticas de acceso más estrictas sobre esa información.

## 11. Modelo de datos (propuesta)

Estructura inicial de tablas. Los campos marcados como *cifrado* se almacenan con cifrado a nivel de campo.

**`core.servers`** — servidores de base de datos
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| nombre | texto | Nombre descriptivo |
| motor | enum | sqlserver / mysql / postgres / mongo / cloudsql |
| host | texto | Host o dirección |
| puerto | entero | Puerto |
| entorno | texto | producción / pruebas / etc. |
| creado_en | timestamp | Fecha de alta |

**`secrets.credentials`** — credenciales de acceso (aisladas y cifradas)
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| server_id | FK → core.servers | Servidor asociado |
| usuario | texto | Usuario de conexión |
| password | texto *(cifrado)* | Contraseña |
| extra | jsonb *(cifrado)* | Datos extra (clave de servicio GCP, etc.) |

**`core.databases`** — bases de datos a respaldar
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| server_id | FK → core.servers | Servidor |
| nombre_bd | texto | Nombre de la base |
| esquemas | jsonb | Esquemas a incluir (Postgres) |

**`core.backup_jobs`** — trabajos de backup
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| nombre | texto | Nombre del trabajo |
| database_id | FK → core.databases | Base objetivo |
| metodo | enum | dump / gcloud |
| formato | texto | Formato/compresión |
| ruta_destino | texto | Carpeta o bucket de salida |
| opciones | jsonb | Flags adicionales del comando |

**`core.schedules`** — programaciones
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| backup_job_id | FK → core.backup_jobs | Trabajo asociado |
| hora_inicio | time | Hora de disparo |
| frecuencia | texto | única / diaria / semanal / cron |
| zona_horaria | texto | Zona horaria |
| activo | booleano | Habilitada o no |

**`core.executions`** — historial de ejecuciones
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| backup_job_id | FK → core.backup_jobs | Trabajo |
| estado | enum | pendiente / en ejecución / éxito / fallo |
| origen | enum | manual / programado |
| inicio | timestamp | Hora de inicio |
| fin | timestamp | Hora de fin |
| duracion_seg | entero | Duración en segundos |
| archivo | texto | Nombre del archivo |
| ruta | texto | Ruta o bucket |
| peso_bytes | entero | Peso del archivo |
| log | texto | Salida de consola capturada |

**`core.notification_channels`** — canales de notificación
| Campo | Tipo | Descripción |
|---|---|---|
| id | uuid / serial | Identificador |
| tipo | enum | email / telegram |
| config | jsonb *(parcialmente cifrado)* | SMTP / token bot / destinatarios |
| activo | booleano | Habilitado o no |

## 12. Almacenamiento de backups

Los archivos se guardan en la ruta de destino configurada por cada trabajo. Se recomienda una convención de nombres y carpetas predecible para facilitar la búsqueda y la futura política de retención.

**Convención de ruta sugerida:**

```
{ruta_destino}/{motor}/{servidor}/{base}/{base}_{YYYYMMDD_HHMMSS}.{ext}
```

Ejemplo: `/backups/postgres/srv-prod-01/ventas/ventas_20260604_020000.dump`

El destino puede ser **local/NAS/recurso compartido** o un **bucket de Google Cloud Storage**, según el trabajo:
- En el **método `gcloud` (exportación gestionada)**, el archivo lo deposita Cloud SQL directamente en el bucket.
- En el **método dump**, el archivo se genera primero en el almacenamiento de DBKeeper y, opcionalmente, se sube al bucket con `gcloud storage cp`. En este caso conviene replicar el patrón del script de MongoDB: subir el backup (y su log), **validar que existan en GCS** (`gcloud storage ls`) y solo entonces eliminar la copia local. La estructura en el bucket sigue una convención equivalente, p. ej. `gs://BUCKET/{base}/{YYYYMMDD}/{archivo}`.

## 13. Variables de entorno (`.env`)

El `.env` se mantiene mínimo. Solo lo necesario para que la aplicación arranque y pueda leer/descifrar el resto de configuración desde la base de datos.

```dotenv
# --- Aplicación ---
APP_ENV=production
APP_SECRET_KEY=                 # clave para firmar sesiones/tokens

# --- Cifrado ---
DBKEEPER_MASTER_KEY=            # clave maestra (Fernet) para descifrar secretos en BD

# --- Base de datos de metadatos (única conexión que no puede vivir en BD) ---
DATABASE_URL=postgresql://usuario:password@host:5432/dbkeeper

# --- Broker de tareas / tiempo real ---
REDIS_URL=redis://host:6379/0
```

Todo lo demás —credenciales de los servidores destino, configuración SMTP, token de Telegram, credenciales de `gcloud`, trabajos y programaciones— se almacena en la base de datos (cifrado cuando es sensible).

## 14. Requisitos no funcionales

- **Ejecución asíncrona:** los backups no deben bloquear la interfaz; corren en el worker.
- **Reintentos:** un backup fallido debe poder reintentarse, manual o automáticamente.
- **Trazabilidad:** toda ejecución queda registrada con su resultado y su log.
- **Seguridad:** secretos cifrados en reposo, nunca en texto plano ni en logs/notificaciones.
- **Concurrencia:** posibilidad de ejecutar varios backups en paralelo según la capacidad del worker.
- **Zonas horarias:** las programaciones respetan la zona horaria configurada.

## 15. Próximos pasos

1. **Scripts recibidos e integrados como adaptadores (método dump):** MySQL (`mysql_backup.py`), PostgreSQL (`pg_backup.py`) y MongoDB (`mongo_backup_telegram.py`) — ver **Anexo A**.
2. Unificar el comportamiento de los adaptadores según las inconsistencias detectadas (ver **Anexo C**).
3. Confirmar el stack definitivo (FastAPI/Celery/React u otras preferencias del equipo).
4. Definir la estrategia de cifrado concreta (Fernet a nivel de aplicación vs. pgcrypto a nivel de columna).
5. Cerrar el modelo de datos y crear las migraciones iniciales.
6. Definir el adaptador de SQL Server (compresión nativa) y el flujo de exportación con `gcloud` a GCS.
7. Establecer la política de retención de backups (cuántas copias conservar y por cuánto tiempo).

---

## Anexo A — Adaptadores por motor (derivado de los scripts actuales)

Los scripts de Python que hoy se ejecutan manualmente ya implementan buena parte de la lógica que DBKeeper necesita. Se integran detrás de una **interfaz común**, de modo que el worker los invoque de forma uniforme sin importar el motor.

### A.1 Interfaz común propuesta

Cada adaptador de motor expone las mismas operaciones:

- `validar_herramienta()` — comprueba que el binario exista (`pg_dump`, `mysqldump`, etc.).
- `validar_conexion()` — prueba la conexión y recoge metadatos (versión, tamaño de la BD).
- `ejecutar(on_progreso, on_log)` — lanza el volcado, reporta avance (callback de progreso) y emite líneas de consola (callback de log).
- `post_proceso()` — pasos posteriores específicos del motor (limpieza de `DEFINER`, compresión).
- `validar_integridad()` — verifica el archivo resultante.
- Devuelve un resultado con: estado, archivo, ruta, peso, inicio, fin, duración y log.

Los dos callbacks (`on_progreso`, `on_log`) son los que alimentan la **barra de progreso** y la **consola en vivo** del frontend (Sección 7), y el resultado final alimenta las **notificaciones** (Sección 8).

### A.2 Adaptador PostgreSQL — `pg_backup.py`

- **Herramienta:** `pg_dump`. Validación previa de conexión con `psycopg2`.
- **Metadatos previos:** obtiene `version()` y `pg_database_size()`. El tamaño de la BD es útil para **estimar el porcentaje de progreso** (bytes escritos frente a tamaño esperado).
- **Comando:** `pg_dump --verbose --serializable-deferrable --no-owner --no-privileges -h <host> -p <port> -U <user> -d <db>`.
- **Exclusión de tablas:** añade `--exclude-table` por cada tabla configurada.
- **Salida:** SQL plano canalizado a `gzip` en streaming (`.sql.gz`), o `.sql` si la compresión está desactivada.
- **Progreso en tiempo real:** un hilo monitorea el tamaño del archivo cada N segundos e informa los MB escritos. → Alimenta directamente la barra de progreso.
- **Verbosidad de consola:** captura el `stderr` de `pg_dump --verbose` línea por línea y resalta las líneas con `error`/`fatal`/`warning`. → Alimenta la consola en vivo.
- **Timeout:** cancela el proceso y elimina el archivo parcial si se supera el tiempo configurado.
- **Integridad:** lee el stream gzip completo (equivalente a `gunzip -t`) y descarta el archivo si está corrupto.
- **Reporta:** nombre del archivo, tamaño en MB y ruta absoluta.

### A.3 Adaptador MySQL — `mysql_backup.py`

- **Herramientas:** `mysqldump` para el volcado y el cliente `mysql` para la prueba de conexión. Ambas rutas son configurables (relevante en Windows).
- **Validación de herramienta:** ejecuta `mysqldump --version` y, si falta, muestra instrucciones de instalación según el sistema operativo.
- **Validación previa:** ejecuta `SELECT VERSION(), DATABASE(), USER();` con timeout y analiza errores comunes (credenciales inválidas, base inexistente, conexión rechazada).
- **Comando:** `mysqldump --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF <db>`.
- **Salida:** `.sql` redirigido a archivo; compresión posterior con `gzip -f` → `.sql.gz`.
- **Limpieza DEFINER:** elimina las cláusulas `DEFINER=...` mediante expresión regular, para que el dump sea restaurable en **Cloud SQL (GCP)**. Es un paso opcional y configurable.
- **Logging:** genera un archivo de log por ejecución con marca de tiempo, con salida simultánea a consola.
- **Reporta:** tamaño del archivo en MB.

### A.4 Adaptador MongoDB — `mongo_backup_telegram.py`

- **Contexto:** respalda **MongoDB Atlas** (servicio gestionado de MongoDB), con cadena de conexión `mongodb+srv://`. Atlas no es Cloud SQL, por lo que **solo aplica el método dump** (`mongodump`); no existe `gcloud sql export` para Mongo.
- **Prueba de conexión:** `mongosh` ejecutando `db.runCommand({ ping: 1 })`.
- **Comando:** `mongodump --uri=... --archive=<archivo>.gz --gzip --verbose`. La URI incluye `retryWrites=true&w=majority&tls=true&readPreference=secondaryPreferred`; esto último hace que el volcado lea de un **nodo secundario** para no cargar el primario.
- **Salida:** archivo único comprimido `{db}-{timestamp}.gz` (formato *archive* de mongodump con gzip).
- **Reintentos:** hasta `MAX_RETRIES` intentos con espera de `RETRY_WAIT` segundos, reintentando específicamente cuando un nodo de Atlas está en mantenimiento (errores `shutdowninprogress` / `quiesce mode`).
- **Almacenamiento en GCS:** sube el backup y su log a `gs://.../{fecha}/` con `gcloud storage cp`, valida que existan con `gcloud storage ls` y solo entonces elimina la copia local. Aquí GCS es **destino de almacenamiento**, no método de generación (ver nota en la Sección 4.2 y la Sección 12).
- **Notificaciones:** envía mensajes de **Telegram** en cada etapa (inicio, backup generado, subida a GCS, limpieza local y cierre con estado y duración) mediante la API del bot. Es la **implementación de referencia** del canal Telegram descrito en la Sección 8.
- **Reporta:** estado final (`OK` / `FAILED`) y duración total.

## Anexo B — Variables `.env` actuales y su destino en DBKeeper

Los scripts actuales guardan toda su configuración en el `.env` (con nombres distintos entre sí). En DBKeeper, la mayoría de estas variables pasan a ser **configuración en la base de datos** (por servidor o por trabajo), y solo unas pocas opciones de sistema permanecen como configuración de entorno. Esto materializa el principio de "`.env` mínimo" de la Sección 13.

| Variable actual | Script | Significado | Destino en DBKeeper |
|---|---|---|---|
| `DB_HOST` / `MYSQL_HOST` / `MONGO_CLUSTER` | PG / MySQL / Mongo | Host o clúster del servidor | `core.servers.host` |
| `DB_PORT` / `MYSQL_PORT` | PG / MySQL | Puerto | `core.servers.puerto` |
| `DB_NAME` / `MYSQL_DATABASE` / `MONGO_DB` | PG / MySQL / Mongo | Base de datos | `core.databases.nombre_bd` |
| `DB_USER` / `MYSQL_USER` / `MONGO_USER` | PG / MySQL / Mongo | Usuario | `secrets.credentials.usuario` |
| `DB_PASSWORD` / `MYSQL_PASSWORD` / `MONGO_PASSWORD` | PG / MySQL / Mongo | Contraseña | `secrets.credentials.password` *(cifrado)* |
| `BACKUP_DIR` | PG / MySQL / Mongo | Ruta de destino local | `core.backup_jobs.ruta_destino` |
| `BACKUP_COMPRESS` / `COMPRESS_BACKUP` | PG / MySQL | Comprimir o no | `core.backup_jobs.opciones` |
| `EXCLUDE_TABLES` | PG | Tablas a excluir | `core.backup_jobs.opciones` |
| `AMBIENTE` | PG | Sufijo de entorno en el nombre | `core.servers.entorno` |
| `BACKUP_TIMEOUT` | PG | Tiempo máximo del backup | `core.backup_jobs.opciones` |
| `BACKUP_PROGRESS_INTERVAL` | PG | Intervalo de reporte de progreso | `core.backup_jobs.opciones` / global |
| `CLEAN_DEFINERS` | MySQL | Limpiar `DEFINER` (Cloud SQL) | `core.backup_jobs.opciones` |
| `MAX_RETRIES` / `RETRY_WAIT` | Mongo | Reintentos y espera entre intentos | `core.backup_jobs.opciones` |
| `UPLOAD_TO_GCS` | Mongo | Subir el backup a un bucket de GCS | `core.backup_jobs.opciones` |
| `GCS_BUCKET_PATH` | Mongo | Bucket/ruta de destino en GCS | `core.backup_jobs.ruta_destino` |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` | Mongo | Notificación por Telegram | `core.notification_channels.config` *(token cifrado)* |
| `MYSQLDUMP_PATH` / `MYSQL_PATH` | MySQL | Rutas a los binarios | Configuración del **worker/host** |
| `LOG_FILE` / `LOG_DIR` | PG / MySQL / Mongo | Ubicación de logs | Gestionado por el sistema (`core.executions.log`) |

Tras esta migración, en el `.env` solo permanece el conjunto mínimo de arranque descrito en la Sección 13 (clave de aplicación, clave maestra de cifrado, conexión a la BD de metadatos y broker de tareas). Las rutas de binarios pueden tratarse como configuración del worker por host, no del proyecto.

## Anexo C — Inconsistencias entre scripts a unificar

Los adaptadores hacen lo mismo de formas distintas. DBKeeper debe homogeneizar este comportamiento. **Importante:** unificar aquí **no cambia cómo se genera cada backup** —el comando de volcado, sus flags y el archivo resultante siguen siendo idénticos a los del script— solo estandariza el comportamiento que lo rodea (logging, progreso, integridad, timeout, reintentos, notificaciones y almacenamiento) y lleva a cada motor al mejor patrón que ya exista en alguno de los tres scripts. Por ejemplo: MySQL no reporta progreso ni valida integridad (Postgres sí), y solo Mongo trae reintentos, subida a GCS y notificaciones por Telegram. "Unificar" significa que todos los motores hereden esos buenos patrones, sin tocar el comando de volcado de cada uno.

| Aspecto | PostgreSQL hoy | MySQL hoy | Decisión en DBKeeper |
|---|---|---|---|
| Logging | Un único archivo `LOG_FILE` (append) | Un log por ejecución con timestamp | Centralizar el log de cada ejecución en `core.executions.log` |
| Compresión | `gzip` de Python en streaming | Comando externo `gzip -f` | Un único mecanismo de compresión común |
| Progreso | Monitor de tamaño de archivo en hilo | Sin reporte de avance | Portar el monitor de progreso a todos los motores |
| Integridad | Valida el `.gz` (lectura completa) | Sin validación | Verificación de integridad en todos los motores |
| Timeout | `BACKUP_TIMEOUT` configurable | Sin timeout | Timeout configurable para todos |
| Nombre de archivo | `backup_{bd}_{amb}_{ts}.sql.gz` | `{bd}_backup_{ts}.sql.gz` | Convención única (Sección 12) |
| Nomenclatura `.env` | `DB_*` | `MYSQL_*` | Se elimina al mover la config a la BD con un esquema único |
| Limpieza DEFINER | No aplica | Sí (Cloud SQL) | Mantener como opción específica de MySQL |
