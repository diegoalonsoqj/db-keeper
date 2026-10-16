# Changelog

Avances de DBKeeper, organizados por etapa de desarrollo.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

## [Etapa 4 · parte 47] — Exclusión de colecciones en MongoDB · 2026-10-15

### Añadido
- Opción de evento **`excludeCollections`** (Mongo): reglas con `*` sin distinguir
  mayúsculas (`*_old`, `*_bak`, `tmp_*`, nombres exactos) y prefijo opcional `<bd>.`
  para limitar una regla a una base. Se resuelven contra las colecciones que existen
  al ejecutar (las nuevas que coinciden también se excluyen) y pasan a mongodump como
  `--excludeCollection`. El log de cada base lista las excluidas y la regla que lo hizo.
  Si las reglas excluyen todas las colecciones de una base, el ítem falla en vez de
  generar un backup vacío. Si no se pueden listar las colecciones, también falla: no se
  respalda ignorando la exclusión.
- Selector en el modal del evento: "Ver colecciones" por base (`POST
  /servers/:id/databases/collections`, también con MongoDB 3.6), buscador por texto o
  patrón, "Excluir filtradas" y vista previa en vivo de qué excluye cada regla. La
  misma función de `@dbkeeper/shared` decide en la vista previa y en el backup.
- Casilla **"Distinguir mayúsculas"** (`excludeCollectionsCaseSensitive`, desactivada
  por defecto): si está activa, `*_bak` no excluye `X_BAK` y una colección marcada a
  mano no arrastra a otra que solo cambia en mayúsculas. El log indica el modo usado.

## [Etapa 4 · parte 46] — Instancia líder y host por ejecución · 2026-10-15

### Añadido
- **Candado de líder** (`pg_try_advisory_lock` en una conexión dedicada): si varias
  instancias comparten la BD de metadatos, solo la líder corre la recuperación de
  ejecuciones, la cola, el scheduler, el verificador de exports y el GC de discos
  temporales. Las demás solo sirven la API, registran quién tiene el candado y toman el
  relevo (reintento cada 30 s) si la líder se apaga.
- Columna `core.executions.runner_host` (migración `0034`): host que corrió cada ejecución,
  visible en *Ejecuciones*. Las conexiones se identifican como `dbkeeper@<host>` en
  `pg_stat_activity`.

### Corregido
- `runner.ts` tenía bytes de control literales en una regex (git lo trataba como binario);
  ahora usa `\x00-\x1f`.

## [Etapa 4 · parte 45] — Grupos de eventos · 2026-10-14

### Añadido
- **Grupos de eventos** (página *Grupos*, `/api/groups`): agrupan eventos para programarlos
  o lanzarlos juntos. Cada evento del grupo crea su propia ejecución; la cola decide el
  paralelismo (exports de Cloud SQL de instancias distintas en paralelo, dumps según
  `maxConcurrentDumps`, una ejecución por instancia). Exports primero, luego el orden del grupo.
- Programación por grupo (mismo modal que la de un evento) con aviso si coincide en horario
  con otro grupo o evento que comparte eventos; botón "Ejecutar grupo ahora".
- Avisos (correo y Telegram) por ejecución con la fila **Grupo** y el asunto
  `[DBKeeper] [<grupo>] …`. Filtro y etiqueta de grupo en *Ejecuciones*; el panel muestra
  también las próximas programaciones de grupos.
- Permisos `groups:read`, `groups:write` y `groups:run`. La migración `0033` los asigna a
  los roles existentes según sus permisos de backups (leer, programar, ejecutar).

## [Etapa 4 · parte 44] — Copia local en eventos a bucket · 2026-10-14

### Añadido
- Opción de evento **`keepLocalCopy`** (solo método `gcloud`, checkbox en el modal): tras
  subir y verificar el dump en el bucket, la copia local no se borra. La retención no
  limpia estas copias (se gestionan a mano).

### Cambiado
- Si la subida al bucket (o su verificación) falla, el dump local ya generado **se
  conserva** en vez de borrarse; el log del ítem indica la ruta y el comando
  `gcloud storage cp` para subirlo a mano.

## [Etapa 4 · parte 43] — Seguridad: escalada de privilegios y nombres de BD · 2026-10-11

### Seguridad
- **Escalada de privilegios (usuarios y roles):** `users:write` ya no basta para volverse
  superadmin. Reglas (`modules/auth/privileges.ts`):
  - Solo un superadmin asigna/quita el rol superadmin.
  - Nadie asigna roles ni otorga permisos a un rol que él mismo no tiene.
  - Nadie modifica (contraseña, estado, roles) ni elimina a un usuario con más permisos
    que él (incluido cualquier superadmin, salvo otro superadmin).
  - Nadie cambia sus propios roles ni desactiva su propia cuenta.
  - Siempre queda al menos un superadmin activo.
- **Robo de credenciales por nombre de BD:** se rechazan nombres que `pg_dump` tomaría
  como cadena de conexión (`host=… dbname=…`, `postgresql://…`) o que `pg_dump`/
  `mysqldump` tomarían como opción (empiezan con `-`), y caracteres de control
  (`databaseNameError`). Se valida en la API (eventos y descubrimiento) y otra vez en el
  motor antes de lanzar el dump (cubre eventos ya guardados y reintentos).

## [Etapa 4 · parte 42] — Volver a la página pedida tras el login · 2026-10-11

### Cambiado
- Al iniciar sesión se vuelve a la página que se pidió (con sus filtros, orden y
  página), no siempre al Panel. Solo se aceptan rutas internas (`postLoginTarget`:
  rechaza `//host`, `/\host`, URLs absolutas y el propio `/login`), sin redirección
  abierta.

## [Etapa 4 · parte 41] — Dependencias con vulnerabilidades · 2026-10-11

### Seguridad
- `pnpm audit`: de 19 avisos (1 crítico, 4 altos) a 3 sin parche aplicable hoy.
  - API: `nodemailer` 8 → 10.0.11 (varios altos: lectura de archivos/SSRF, DoS en el
    parser de direcciones, validación de dominios); `mysql2` 3.24.4; transitivas de
    Express actualizadas dentro de rango: `proxy-addr` 2.0.8 (crítico: suplantación de
    IP con trust proxy), `qs` 6.16, `body-parser` 2.3; `form-data` 2.5.6; `uuid` 11.1.1
    para `ldapts` (override).
  - Web: `react-router-dom` 6 → 7.18.4 (open redirect / XSS); `vite` 5 → 7.3.6 y
    `@vitejs/plugin-react` 5.2.0 (lectura de archivos del servidor de desarrollo en
    Windows); `browserslist`, `postcss`, `nanoid`, `esbuild` actualizados.
  - Pendientes (riesgo bajo, documentado): `source-map-js` 1.2.2 (solo en tests de la
    API; el parche tiene 11 días, entra solo por la política de abajo), `uuid` 8/9 dentro
    de `@google-cloud/storage` (el aviso afecta v3/v5/v6 con `buf`; la librería usa v4) y
    `sprintf-js` en `tedious` (sin versión corregida publicada).
- `pnpm-workspace.yaml`: `minimumReleaseAge` de 14 días (no se instalan versiones
  recién publicadas) y override `ldapts>uuid`. `vitest` 5.0.3 → 5.0.2 para cumplirla.

### Notas
- `nodemailer` 10 requiere Node.js 20 o superior.

## [Etapa 4 · parte 40] — Selector de rango de fechas · 2026-10-11

### Cambiado
- Ejecuciones y Auditoría: los campos Desde/Hasta pasan a un solo filtro **Fecha** que
  abre un calendario de rango (dos meses; uno en pantallas angostas): primer clic =
  inicio, segundo = fin, dos clics en el mismo día = solo ese día; opción "Desde el …
  en adelante". Atajos: Hoy, Últimos 7 días, Últimos 30 días, Este mes, Mes anterior.
  Días futuros deshabilitados; colores del tema y la paleta activos.
- La URL y la API no cambian (`from`/`to`): los enlaces guardados siguen valiendo.

### Añadido
- Dependencia `react-day-picker` 9.14.0 (calendario accesible, con locales es/en). Se
  carga diferida al abrir el calendario (~23 KB gzip en un chunk aparte).

## [Etapa 4 · parte 39] — Buscador, filtros y orden en los listados · 2026-10-11

### Añadido
- Barra común (`ListToolbar`) con buscador (se aplica al dejar de escribir), filtros
  propios de cada tabla y "Limpiar"; orden por columna con clic en el encabezado
  (`SortTh`). Todo se resuelve en la API (los listados están paginados) y queda en la
  URL (`useListParams`): sobrevive a recargar y se puede compartir.
  - **Ejecuciones**: evento o código `#XXXXXXXX`; estado, origen, ambiente, evento y
    rango de fechas; orden por evento, estado, ambiente, BD, creada, finalizada,
    duración y peso.
  - **Eventos de backup**: nombre; instancia, método, ambiente, programado/solo manual,
    activo.
  - **Instancias**: nombre, host o instancia Cloud SQL; motor, plataforma
    (autogestionada/Cloud SQL/AlloyDB), ambiente.
  - **Credenciales**: nombre o usuario; ambiente.
  - **Usuarios**: usuario, nombre o correo; rol, tipo (local/AD), estado.
  - **Auditoría**: mismos filtros, ahora en la barra común (sin botón "Aplicar") y con
    orden por columna.
- API: `q`, `sort`, `dir` y filtros por listado, validados con Zod (las claves de orden
  se traducen a expresiones SQL fijas) y siempre parametrizados; comodines de LIKE
  escapados. Migración `0032`: índice `(status, created_at DESC)` en ejecuciones.

### Corregido
- Los filtros de fecha de Auditoría usan el día en la zona del navegador (antes, UTC).
- El filtro de usuario de Auditoría escapa `%` y `_`.

## [Etapa 4 · parte 38] — Avisos agrupados por ejecución · 2026-10-11

### Cambiado
- Asunto fijo por ejecución, sin estado, para que inicio, fin, interrupción, disco
  temporal e integridad queden en un mismo hilo:
  `[DBKeeper] <instancia> · <evento> · <fecha> · #<código>`. La instancia se omite si el
  nombre del evento ya la contiene (convención `BK - <instancia>`). La fecha es la de la
  ejecución (no cambia si termina al día siguiente).
- El estado va en la vista previa del correo (texto oculto al inicio): "Completado — 2 BD,
  3.2 GB en 12m 4s", "Con errores — 1 de 2 BD falló (clientes)", etc.
- Resumen del aviso con filas **Instancia** y **Ejecución** (`#código`).

### Añadido
- Código de ejecución (`executionCode`: 8 primeros caracteres del id) visible en
  Ejecuciones, bajo el nombre del evento, para cruzarlo con los avisos.
- SMTP: cabeceras `In-Reply-To`/`References` por ejecución (hilo más fiable). La API
  notify agrupa solo por asunto.
- Telegram en hilo: el primer aviso de la ejecución queda como raíz (migración `0031`,
  `executions.telegram_chat_id/telegram_message_id`) y los siguientes se envían como
  respuesta, incluso la alerta de integridad días después.

## [Etapa 4 · parte 37] — API de correo "notify" y plantilla HTML · 2026-10-11

### Cambiado
- Notificaciones → Email → API envía ahora el formato de la API "notify":
  `{ title, subject, htmlContent, from: {name, email}, to: [{email}] }`, con **Título**
  editable y el remitente tomado de `Nombre <correo>`. Se elimina el cuerpo genérico
  anterior (`{ from, to, subject, text, html }`), que no correspondía a ningún servicio.

### Añadido
- Plantilla HTML propia para los correos (`email-template.ts`): tarjeta con barra y
  etiqueta de estado por color, resumen en tabla y detalle por BD; compatible con
  Outlook/Gmail (tablas + estilos inline), sin emojis. Telegram mantiene su formato.

## [Etapa 4 · parte 36] — Dump paralelo con disco temporal (AlloyDB) · 2026-10-11

### Añadido
- **Método `pg_parallel` (Dump paralelo, directorio)** para PostgreSQL/AlloyDB grandes:
  por ejecución crea un disco **nuevo** de GCE en la VM de DBKeeper, lo formatea y monta
  (`/backup-alloydb`), corre `pg_dump -Fd -j N` por BD, valida el TOC con
  `pg_restore --list`, sube la carpeta al bucket en paralelo con hashes al vuelo, verifica
  cada objeto (tamaño + CRC32C) y sube `manifest.json` como marca de backup completo. Al
  final (también si falla o se cancela) desmonta, desadjunta y borra el disco.
- Opciones del evento: workers (`-j`, sugerido vCPU − 2, máx. 14), **quitar permisos
  (GRANT/REVOKE)** (desmarcado por defecto, como el script), tamaño/tipo de disco
  (automático: último backup + margen), duración máxima por BD y patrones de ruido de
  stderr (por defecto el de AlloyDB `TopTransactionContext IS NOT NULL`).
- Configuración → **Disco temporal**: habilitar, punto de montaje, credencial GCP, tipo y
  tamaños, margen, revisión de huérfanos y **Probar configuración** (VM, credencial,
  permisos IAM, helper, binarios; no crea nada).
- Instancias: **Plataforma** PostgreSQL / Cloud SQL / AlloyDB (migración `0030`).
- **Cancelar ejecución** (`POST /backups/executions/:id/cancel`): en cola se cierra sin
  lanzarse; un dump paralelo en curso se detiene (pg_dump y workers) y libera el disco.
- Recolector de discos temporales huérfanos (etiqueta `dbkeeper=scratch`) al arrancar y
  periódicamente. Si no se puede desmontar, el disco no se borra y se avisa.
- Helper root `ops/dbkeeper-scratch.sh` + guía `ops/README-scratch.md` (sudoers acotado,
  rol IAM personalizado). Identifica el disco por `/dev/disk/by-id/google-*` y nunca
  formatea un disco con firma, particiones, montado o de arranque.
- "Verificar ahora" para backups en carpeta: relee `manifest.json` y compara cada objeto.

### Cambiado
- La cola lanza un solo `pg_parallel` a la vez (punto de montaje único).
- `pg_restore` (solo lee el TOC del dump para validarlo; no restaura) se toma por defecto
  de la misma carpeta que `PG_DUMP_PATH`: misma versión y sin variable extra en `.env`.
- Las subidas en paralelo al bucket se configuran en Configuración → Disco temporal
  (antes `GCS_UPLOAD_CONCURRENCY` en `.env`, que se elimina; por defecto 8).
- `ExecutionDto` incluye `method`. Los backups en carpeta (URI terminada en `/`) no se
  descargan por la web: se copia el comando `gcloud storage cp -r`.

## [Etapa 4 · parte 35] — Excluir event triggers del backup (PostgreSQL) · 2026-10-05

### Añadido
- **Excluir event triggers del backup**: nueva opción `options.excludeEventTriggers =
  { bd: [triggers] }`. Restaurar en un destino sin superuser (Cloud SQL, import) fallaba con
  `permission denied to create event trigger … Must be superuser`. Como pg_dump no tiene
  `--exclude-event-trigger`, se filtra su salida en streaming: se quitan las sentencias
  completas `CREATE`/`ALTER`/`COMMENT ON EVENT TRIGGER` de los triggers elegidos (multilínea,
  con `;` dentro de literales o nombres entre comillas). No se tocan los datos de los `COPY`
  ni la función `RETURNS event_trigger`. El log indica qué triggers se excluyeron y avisa si
  alguno marcado no aparecía en el dump.
- Endpoint `POST /servers/:serverId/databases/event-triggers` (`servers:read`) y sección
  «Event triggers excluidos» en el modal, con `nombre (evento)` y si está deshabilitado.

### Cambiado
- Un solo filtro de salida de pg_dump (`engine/pg-filter.ts`) para `pgCompat` y event
  triggers; reemplaza a `pg-compat.ts`.
- Las secciones de exclusión por BD del modal (esquemas, extensiones, event triggers)
  comparten componente y hook (`ExcludeByDbSection`, `useDbExclusions`); el descubrimiento
  de PostgreSQL por BD comparte la conexión (`withDbClient`).

## [Etapa 4 · parte 34] — Compatibilidad de dumps PostgreSQL y exclusión de extensiones · 2026-10-05

### Añadido
- **Excluir extensiones del backup (PostgreSQL)**: nueva opción de evento
  `options.excludeExtensions = { bd: [extensiones] }`, que se traduce en
  `--exclude-extension="<nombre>"` (literal, comillas internas duplicadas). En el modal,
  sección «Extensiones excluidas» con «Cargar extensiones» por BD (`nombre (versión)`); las
  ya excluidas aparecen marcadas aunque no se recarguen. Nuevo endpoint
  `POST /servers/:serverId/databases/extensions` (`servers:read`), que omite `plpgsql`. El
  log del job registra qué extensiones se excluyeron. Requiere **pg_dump ≥ 17**: con uno
  anterior el dump falla de inmediato con un mensaje claro. Pensado para extensiones sin
  objetos usados por la BD (p. ej. `pgaudit`, ausente en la instancia de destino); excluir
  una de la que dependen tablas (postgis, citext, uuid-ossp, hstore) hace fallar el restore.
- **Dumps PostgreSQL compatibles con versiones anteriores** (`options.pgCompat`, activa por
  defecto): quita `SET transaction_timeout = 0;` (PG17+) y `\restrict`/`\unrestrict`, que
  hacían fallar el import de Cloud SQL en PG ≤ 16. Los datos de los `COPY` no se tocan. La
  compresión pasa de `pg_dump -Z` a gzip en Node.
- **Tests unitarios** con Vitest (`pnpm --filter @dbkeeper/api test`): argumentos
  `--exclude-*`, normalización de exclusiones y filtro `pgCompat`.

### Cambiado
- La normalización de `excludeSchemas` y `excludeExtensions` comparte la misma lógica
  (`backups/exclusions.ts`): solo BDs del evento, nombres recortados y únicos, máx. 200 por BD.
- Logo de marca (favicon, menú y login) a la escala del de db-refresh.

## [Etapa 4 · parte 33] — Descubrir BDs con la credencial del evento · 2026-06-11

### Añadido
- **El descubrimiento de BDs respeta la credencial del evento**: `POST …/databases/discover`
  acepta un `credentialId` opcional y usa esa credencial (override), cayendo a la de la
  instancia si no se envía. Antes solo usaba la de la instancia, así que una instancia sin
  credencial base no se podía descubrir aunque se eligiera una credencial en el evento. El
  modal envía la credencial efectiva (override ∥ la de la instancia).

## [Etapa 4 · parte 32] — Opciones de dump también en eventos a bucket · 2026-06-11

### Corregido
- **Las opciones del dump (compresión, verbose, exclude-tables, cleanDefiners) se ignoraban en
  eventos a bucket**: estaban condicionadas a `method === "dump"`, así que al guardar un evento
  "Subir a bucket" se **borraban** todas (dump sin comprimir y sin `--verbose`, por eso el log
  en vivo no mostraba la creación del backup, solo la subida). Ahora aplican a ambos métodos —
  "Subir a bucket" también ejecuta el dump, solo cambia el destino.
  > Nota: los eventos a bucket creados antes de este fix tienen esas opciones ya vacías;
  > vuelve a editarlos y guardar para reactivar compresión/verbose.

## [Etapa 4 · parte 31] — Almacenamiento en las notificaciones · 2026-06-11

### Añadido
- **Línea "Almacenamiento"** en los avisos (correo y Telegram): indica dónde quedó el backup —
  `Local` o `<bucket>/<prefijo>/<instancia>` para destino GCS. Aparece en el resumen junto a
  motor/ambiente/BDs.

## [Etapa 4 · parte 30] — Log de la fase de subida a bucket · 2026-06-11

### Añadido
- **Log de subida a GCS**: los eventos a bucket ahora registran en el log por BD (persistido y
  en vivo por SSE) el destino `gs://…`, el tamaño y la duración de la subida, y la limpieza de
  la copia local de staging. Antes el log solo traía la salida del dumper, así que un evento a
  bucket no dejaba rastro de a dónde ni cuánto subió.

### Interno
- `formatBytes` se extrae a `lib/format.ts` y se reutiliza en el runner y en notificaciones
  (antes estaba duplicado en notifications.service).

## [Etapa 4 · parte 29] — Ruta en bucket por instancia · 2026-06-11

### Cambiado
- **Layout del objeto en GCS**: la ruta pasa de `<prefijo>/<motor>/<archivo>` a
  `<prefijo>/<instancia>/<archivo>`, agrupando por **nombre de instancia** para caer en las
  carpetas que el bucket ya mantiene por instancia. `safeFileName` conserva mayúsculas (GCS es
  case-sensitive). Los objetos ya subidos no se mueven; solo aplica a backups nuevos.
- **Layout local**: el destino local pasa de `<BACKUP_DIR>/<motor>/<archivo>` a
  `<BACKUP_DIR>/<motor>/<instancia>/<archivo>`. El registro guarda la ruta absoluta, así que
  descarga y retención siguen funcionando; los archivos previos no se mueven.

## [Etapa 4 · parte 28] — Cookie de sesión configurable para HTTP interno · 2026-06-11

### Corregido
- **Sesión no persistía en prod por HTTP**: la cookie se marcaba `secure` cuando
  `APP_ENV=production`, así que en un despliegue interno **sin TLS** el navegador la
  descartaba y todo respondía *No autenticado* tras un login aparentemente exitoso.

### Añadido
- **`COOKIE_SECURE`**: nueva variable que desacopla el flag `secure` de la cookie de
  `APP_ENV`. Sin definir conserva el comportamiento seguro (true en producción); ponerla en
  `false` permite servir por HTTP interno. `login` y `logout` usan el nuevo `cookieSecure`
  de `config/env.ts`, y el `clearCookie` alinea atributos para borrar bien la cookie.

## [Etapa 4 · parte 27] — Fix despliegue un-solo-puerto + doc de producción · 2026-06-11

### Corregido
- **Ruta del build del front**: `WEB_DIST_PATH` apuntaba a `../../web/dist` (raíz del repo)
  en vez de `../web/dist` (`apps/web/dist`), provocando `ENOENT … web/dist/index.html` al
  arrancar con `SERVE_WEB=true`. Corregido el default en `config/env.ts` y `.env.example`.

### Documentación
- **README**: nueva sección *Despliegue en producción (un solo puerto)* con el flujo de
  build y arranque. Se documenta el **orden de build obligatorio** (`pnpm -r build`: shared →
  api → web); construir `@dbkeeper/api` suelto en un checkout limpio falla con `Cannot find
  module '@dbkeeper/shared'` porque `packages/shared/dist` aún no existe. Tabla de variables
  `SERVE_WEB` / `WEB_DIST_PATH`. Verificado e2e en local y en server Linux de producción.

## [Etapa 4 · parte 26] — Progreso en vivo por tamaño + cronómetro · 2026-06-06

### Añadido
- **Progreso en vivo del dump** sin depender de `--verbose`: el runner **vigila el tamaño del
  archivo** de salida mientras crece (`engine/progress.ts`, muestreo cada 2 s) y lo empuja por
  SSE (nuevo evento `execution-progress`). En *Ejecuciones* la columna **Peso** muestra el
  tamaño creciente («… MB …») por BD y el total de la corrida mientras está en curso. Útil
  para dumps grandes (p. ej. 23 GB) donde el estado se queda en `running` mucho tiempo.
- **Cronómetro en vivo**: la columna **Duración** cuenta el tiempo transcurrido mientras la
  corrida está `running` (antes solo se veía al terminar).
- **Shared**: `BackupStreamEvent` suma la variante `execution-progress`.

### Notas
- No aplica a SQL Server (el `.bak` se escribe en el host de la instancia). Verificado e2e:
  un dump de 486 MB emitió tamaño creciente por SSE (17→38→59→71 MB).

## [Etapa 4 · parte 25] — Nota de seguridad: acceso de solo lectura al origen · 2026-06-06

### Documentación
- Auditoría y documentación de la garantía: DBKeeper **nunca modifica, escribe ni borra
  datos** de las BD respaldadas. Descubrimiento por catálogos (`pg_database` / `SHOW
  DATABASES` / `listDatabases` / `sys.databases`) y dumps de solo lectura (`pg_dump
  --serializable-deferrable`, `mysqldump --single-transaction` sin `--master-data`/
  `--flush-logs`, `mongodump`). **Excepción SQL Server**: `BACKUP DATABASE` no toca los datos
  de usuario pero escribe el `.bak`, el historial en `msdb` y la base diferencial/LSN.
  Recomendación de **menor privilegio** (usuario de backup de solo lectura; `db_backupoperator`
  en SQL Server). Documentado en `README.md` y `docs/ARCHITECTURE.md` (sección Seguridad).

## [Etapa 4 · parte 24] — Log en modal desde la columna Acciones · 2026-06-06

### Cambiado
- El **log por BD** en *Ejecuciones* deja de mostrarse como filas `<details>` inline y pasa a
  un **botón (icono) en la columna Acciones** que abre un **modal**. El modal **streamea en
  vivo** mientras la corrida está en curso (consola) y muestra el **log persistido** al
  terminar; hace **auto-scroll** al pie. Tabla más limpia, mejor para logs `--verbose` largos.
- Nuevo `common.close` (es-419/en) y estilo `pre.log.log-modal` (área alta).

## [Etapa 4 · parte 23] — Consola en vivo (`--verbose` configurable) · 2026-06-06

### Añadido
- **Modo detallado por evento** (`options.verbose`, checkbox en el modal para PostgreSQL,
  MySQL y MongoDB): añade `--verbose` al motor y **transmite su salida en vivo** por el SSE
  (nuevo evento `execution-log`). El motor lee `stderr` **línea a línea**
  (`engine/log-lines.ts`) y el runner la **agrupa en lotes** (cada 300 ms o 50 líneas),
  quita la contraseña y la persiste en `execution_items.log`.
- **Web**: *Ejecuciones* muestra una **«Consola en vivo»** por BD mientras la corrida está en
  curso (se nutre del SSE); al terminar queda el log persistido en *Ver log*.
- **Shared**: `BackupStreamEvent` ahora es unión (`execution-updated` | `execution-log`);
  `verbose` en `BackupOptionKey`/`ENGINE_BACKUP_OPTIONS` (no aplica a SQL Server).

### Notas
- Verificado e2e: una corrida real con `verbose` empujó 104 líneas de progreso de `pg_dump`
  por SSE. En Windows los acentos de `pg_dump` pueden verse mal (emite cp1252 y se decodifica
  como UTF-8); cosmético y preexistente, no ocurre con locale UTF-8 (Linux).

## [Etapa 4 · parte 22] — Progreso en vivo por SSE (Fase A) · 2026-06-06

### Añadido
- **Tiempo real por SSE** (Fase A del diseño `docs/REALTIME-QUEUE-DESIGN.md`, in-proceso, sin
  Redis): nuevo endpoint `GET /api/backups/executions/stream` (`backups:read`) que **empuja
  el snapshot completo de cada ejecución** al cambiar de estado. Bus de eventos in-proceso
  (`modules/backups/events.ts`); el runner emite en cada transición
  (running → ítem running → ítem cerrado → estado final, y en fallos de pre-vuelo).
- **Web**: hook `useExecutionStream` (`EventSource`, reconexión nativa) en *Ejecuciones*; el
  progreso llega push y se hace *merge* por `id`. **Fallback** automático al *poll* (3 s) si
  el SSE no está conectado, y **resync** (refetch) al (re)conectar. Heartbeat cada 25 s.
- **Shared**: `BackupStreamEvent`.

### Notas
- La **Fase B** (cola BullMQ + Redis con pub/sub que alimenta este mismo SSE) queda
  pendiente; el bus ya tiene el punto de extensión preparado. Verificado e2e: las 4
  transiciones de una corrida real (`pg_dump`) se empujaron en orden.

## [Etapa 4 · parte 21] — Retención de backups · 2026-06-06

### Añadido
- **Política de retención por evento** (`options.retention = { days, keepLast }`): borra
  automáticamente los backups antiguos. Se purga un backup exitoso si **supera la antigüedad
  máxima en días** **o** si queda **fuera de los últimos N**; cada regla es opcional. El
  archivo físico se elimina (disco local o GCS) y el ítem se marca como **purgado**
  (`core.execution_items.pruned_at`, migración `0019`) conservando el registro de la
  ejecución para auditoría; deja de ser descargable.
- **Disparo de la limpieza**: tras cada corrida exitosa se aplica la retención del evento
  (limpieza por cantidad inmediata) y el **scheduler** hace un **barrido global cada hora**
  para expirar backups por antigüedad incluso en eventos que ya no se ejecutan.
- **UI**: sección *Retención* en el modal del evento (antigüedad máxima en días y/o conservar
  últimos N); en *Ejecuciones*, los ítems purgados muestran «Purgado» en lugar del botón de
  descarga. i18n es-419/en.

### Notas
- **SQL Server** se omite: su `.bak` queda en el host de la instancia, fuera del alcance del
  servicio, así que la retención no lo elimina (se avisa en el modal).

## [Etapa 4 · parte 20] — Configuración con menú lateral por secciones · 2026-06-06

### Cambiado
- **Página de Configuración** reorganizada con **menú lateral por secciones**
  (General · Almacenamiento · LDAP · Notificaciones): el menú es **fijo** (sticky) y a la
  derecha se muestra **una sección a la vez** a ancho completo. Sustituye a la rejilla
  multicolumna anterior, que dejaba grandes espacios en blanco por las alturas dispares de
  las tarjetas.
- **Distribución de campos** en rejilla fija de **2 columnas** alineada arriba: los campos
  cortos ocupan media columna y los largos (URL/DN/Search Base/User Filter de LDAP;
  remitente, destinatarios, host SMTP y URL de API en Notificaciones) ocupan todo el ancho.
  Títulos, descripciones, checkboxes y acciones a ancho completo. Layout responsive (el menú
  pasa arriba en pantallas angostas).

## [Etapa 4 · parte 19] — Notificaciones (Email + Telegram) · 2026-06-06

### Añadido
- **Notificaciones de backup** por **correo** y **Telegram**, configurables en *Settings*:
  - **Eventos** a notificar: inicio, éxito y/o fallo (`notifyOnStart/Success/Failure`).
  - **Correo** por **SMTP** (`nodemailer`) o por una **API HTTP** genérica (POST JSON con
    header de autorización configurable). **Telegram** vía Bot API.
  - Módulo `modules/notifications/` (`email.ts`, `telegram.ts`, `notifications.service.ts`):
    `notifyBackup` orquesta los canales habilitados, **nunca lanza** y corre en segundo
    plano (no bloquea ni rompe el backup); `sendTestNotification` reporta el resultado por
    canal.
  - El **runner** dispara el aviso de **inicio** y el de **fin** (éxito/fallo) con
    duración, peso total y detalle por BD; también notifica los fallos de pre-vuelo.
  - Config persistida en `app_settings['notifications']` con los **secretos cifrados**
    (contraseña SMTP, auth de la API, bot token); el DTO solo expone banderas `has*`.
    `getNotifRuntimeConfig` descifra únicamente en el momento del envío.
  - Endpoints `PATCH /api/settings/notifications` y `POST /api/settings/notifications/test`
    (`settings:write`); auditoría sin volcar el cuerpo (lleva secretos).
  - **UI** en *Settings*: card con eventos, correo (selector SMTP/API con campos
    condicionales), Telegram y botón **probar envío** (resultado por canal vía toast).
    i18n es-419/en.

### Cambiado
- **Mensaje de notificación con formato**: encabezado por estado (🚀/✅/❌), etiquetas en
  negrita, emoji por campo, nombre presentable del motor (`postgres`→PostgreSQL) y detalle
  por BD. El **ambiente** muestra el **nombre** del catálogo (p. ej. *Producción*) en vez
  del código (*PRD*); el nombre del archivo sigue usando el código.
- **Settings** ahora se muestra en **rejilla multicolumna** (aprovecha el ancho completo en
  vez de apilar tarjetas dejando vacío el lado derecho).

### Corregido
- **Telegram**: el `parse_mode: HTML` no admite `<br>` (daba *"can't parse entities:
  Unsupported start tag br"*). El mensaje de Telegram usa saltos `\n` y solo `<b>`; el
  correo mantiene `<br>`. Los valores dinámicos se escapan.

## [Etapa 4 · parte 18] — Descubrimiento de Mongo Atlas (SRV) · 2026-06-05

### Corregido
- El **descubrimiento de BDs de MongoDB** ahora usa conexión **SRV** (`mongodb+srv://…
  &tls=true`) cuando el host es de Atlas (`.mongodb.net`), igual que el dumper. Antes solo
  usaba `mongodb://host:port`, por lo que "Descubrir" fallaba en clústeres Atlas.

## [Etapa 4 · parte 17] — Avisos propios (toasts + confirmación) · 2026-06-05

### Cambiado
- **Sistema de notificaciones propio** que reemplaza los diálogos nativos del navegador:
  - **Toasts** (`ToastProvider`/`useToast`): pila flotante con auto‑cierre y variantes
    éxito/error/info. Se migró el feedback de las páginas (alta/edición/borrado/ejecución/
    reintento/descarga/errores de carga) de los `<p>` inline a toasts consistentes.
  - **Diálogo de confirmación** custom (`ConfirmProvider`/`useConfirm`, con el `Modal` de
    la app) en vez de `window.confirm()` — usado en los borrados de las 7 páginas, con
    mensaje «¿Eliminar «X»?» y botón en rojo.
  - Migrado también el feedback de **Roles, Perfil y Auditoría** a toasts. Se mantiene
    inline solo el feedback de formulario/página apropiado (login, validación dentro de
    los modales de evento/programación, error de carga del panel).

## [Etapa 4 · parte 16] — Motor SQL Server (`BACKUP DATABASE`) · 2026-06-05

### Añadido
- **Backup de SQL Server** (`engine/sqlserver.ts`) vía el driver `mssql`: `BACKUP DATABASE
  [db] TO DISK = N'<ruta>' WITH FORMAT, INIT, CHECKSUM[, COMPRESSION]`. A diferencia de
  los demás motores, el `.bak` se escribe **en el host de la instancia** (no se transmite
  al cliente), así que el evento indica una **ruta en el servidor** (`options.sqlBackupDir`).
  Se valida con `RESTORE VERIFYONLY` y el **peso** se lee de `msdb.dbo.backupset`.
- El runner trata SQL Server como un flujo aparte: no usa destino local/GCS ni descarga
  (el archivo vive en la instancia); registra ruta + peso + integridad desde el servidor.
- Campo de ruta en el modal para motores SQL Server. Env `sqlBackupDir` por evento.

## [Etapa 4 · parte 15] — Motor MongoDB (`mongodump`) · 2026-06-05

### Añadido
- **Dumper de MongoDB** (`engine/mongo.ts`): `mongodump --archive` (+`--gzip` si se
  comprime) → `.archive`/`.archive.gz` (restaurar con `mongorestore --gzip --archive`).
  Soporta **Atlas** (`mongodb+srv://…&tls=true`, como el script de referencia) y
  **Community** (`mongodb://host:port`). SRV se detecta por host `.mongodb.net` o con la
  opción `mongoSrv` (checkbox en el modal). Credenciales desde la BD; integridad del
  `.gz` validada. Env `MONGODUMP_PATH`.
- Nota: `mongodump` no tiene variable de entorno para la contraseña, así que viaja en la
  URI (se omite de los logs).

## [Etapa 4 · parte 14] — Motor MySQL (`mysqldump`) · 2026-06-05

### Añadido
- **Dumper de MySQL** (`engine/mysql.ts`) con los parámetros del script de referencia:
  `mysqldump --single-transaction --quick --routines --triggers --events --hex-blob
  --set-gtid-purged=OFF`. La contraseña viaja por `MYSQL_PWD` (no en la línea de
  comandos). Canaliza stdout → **limpieza de `DEFINER`** (opcional, compat. Cloud SQL) →
  gzip → archivo; valida integridad y reusa todo el vertical (estados, almacenamiento
  local/GCS, scheduler, descarga, panel). `excludeTables` → `--ignore-table`.
- Opción de evento **`cleanDefiners`** (por defecto activada) con checkbox en el modal
  para motores MySQL. Env `MYSQLDUMP_PATH`.

## [Etapa 4 · parte 13] — Panel (dashboard) · 2026-06-05

### Añadido
- **Panel** con datos reales (antes solo mostraba el health check): KPIs (instancias,
  eventos activos/total, ejecuciones 7 días, % de éxito, peso respaldado), **últimas
  ejecuciones**, **próximas programaciones** y estado de API/BD.
- Endpoint agregado `GET /api/dashboard` (`backups:read`): resuelve todo en pocas
  consultas SQL (sin N+1).

## [Etapa 4 · parte 12] — Scheduler (agendar / recurrente) · 2026-06-05

### Añadido
- **Programación de eventos** (`core.backup_schedules`, migración `0018`): una por
  evento, modo **`once`** (fecha/hora) o **`recurring`** (cron). Endpoints
  `GET/PUT/DELETE /api/backups/:id/schedule` (permiso `backups:schedule`).
- **Poller in-proceso** (cada 60 s): dispara las programaciones vencidas creando la
  ejecución con `origin='scheduled'` y recalcula `next_run_at` (cron) o desactiva (once).
  Es **agnóstico al motor** (solo crea la corrida; el runner hace el dump). Robusto ante
  reinicios (el `next_run_at` está en BD). Usa `cron-parser` para el cálculo.
- **Zona horaria**: por defecto la de Settings (`general.timezone`), guardada en la
  programación; el cron y la hora "once" se interpretan en esa zona.
- **UI**: acción *Programar* por evento → modal **Sin programación / Agendar (fecha+hora
  nativa) / Recurrente** con presets (diario/semanal/mensual) que generan cron + campo
  cron avanzado; muestra el próximo disparo.

## [Etapa 4 · parte 11] — Generalización multi-nube (estructura) · 2026-06-05

### Cambiado
- **Cuentas de servicio multi-nube** (`secrets.gcp_service_accounts → cloud_credentials`,
  migración `0017`): cada cuenta tiene **`provider`** (gcp/aws/azure), `secret_encrypted`
  (credencial propia de la nube) y `metadata` jsonb (datos no secretos, p. ej. GCP:
  `clientEmail`/`projectId`). Módulo renombrado a **Cuentas de servicio**
  (`/api/cloud-credentials`); default **por proveedor**.
- **Destinos de nube multi-proveedor**: `storage_targets` pasa de `type='gcs'` a
  `type='bucket'` con **`provider`** y referencia genérica `cloud_credential_id`. Los
  formularios piden datos según el proveedor.
- De momento **solo GCP es funcional**; `aws`/`azure` quedan como opción ("próximamente")
  con la estructura lista para implementarse sin migración.

## [Etapa 4 · parte 10] — Catálogo de cuentas de servicio GCP · 2026-06-05

### Añadido
- **Módulo Cuentas GCP** (`secrets.gcp_service_accounts`, migración `0016`): clave JSON
  **cifrada** reutilizable; se extraen y muestran `client_email` y `project_id` (no
  secretos). CRUD en `/api/gcp-accounts`, cuenta **por defecto** (indicador en el módulo,
  configurable en Settings).

### Cambiado
- El destino **GCS** deja de guardar el JSON incrustado y **referencia una cuenta** del
  catálogo (`storage_targets.gcp_service_account_id`); el formulario usa un **selector**.
  La migración mueve las claves inline existentes al catálogo y enlaza. El motor y la
  descarga resuelven la credencial desde la cuenta referida.

## [Etapa 4 · parte 9] — Subida a GCS (método gcloud) · 2026-06-05

### Añadido
- **Método `gcloud`** ahora implementado: se genera el dump local (staging) y se **sube
  al bucket** con el SDK `@google-cloud/storage`, usando la **service account del destino
  en memoria** (nunca se escribe a disco). Tras subir, borra la copia local. El ítem
  guarda la URI `gs://bucket/[prefijo/]<motor>/<archivo>`.
- **Descarga desde GCS**: el endpoint de descarga sirve por *streaming* desde el bucket
  cuando el archivo es `gs://…` (resolviendo credenciales por el bucket); los locales se
  sirven igual que antes.

## [Etapa 4 · parte 8] — Módulo Almacenamiento (local + buckets) · 2026-06-05

### Cambiado
- El módulo **Buckets** pasa a **Almacenamiento** (`core.storage_buckets → storage_targets`,
  migración `0015`). Un destino tiene `type` **local** (con `path`) o **gcs** (bucket +
  prefijo + clave de servicio). Endpoints en `/api/storage`.
- **Destino por defecto por tipo** (`is_default`, único por tipo): el módulo lo **muestra**
  con una estrella (indicador, ambos tipos) y se **configura en Settings** (selectores de
  local y bucket por defecto) — un solo lugar para cambiarlo.
- El **motor** escribe los dumps en el `path` del destino local **por defecto** (la
  variable `BACKUP_DIR` queda como *fallback* inicial/seed). La migración siembra un
  destino local por defecto con la ruta de `BACKUP_DIR`.
- Las ejecuciones guardan la **ruta absoluta** del dump (robusto si cambia el destino
  local); las descargas siguen funcionando para registros antiguos (ruta relativa).

## [Etapa 4 · parte 7] — UX: ambiente con nombre e iconos de acción · 2026-06-05

### Cambiado
- Las tablas muestran el ambiente como **`Nombre (CÓDIGO)`** (helper compartido
  `environmentLabel`/`useEnvironments`); cae al código si no está en el catálogo.
- Los **botones de acción** de todas las tablas (Instancias, Credenciales, Ambientes,
  Buckets, Backups, Ejecuciones, Usuarios) pasan a **iconos** (lucide) con **tooltip**
  (`title`) y `aria-label`, en vez de texto.

## [Etapa 4 · parte 6] — Ambiente consolidado en el evento de backup · 2026-06-05

### Añadido
- El **evento de backup** guarda su **ambiente** (`core.backup_jobs.environment`,
  migración `0013`, con backfill desde la instancia). La API lo **consolida**
  (lado servidor) a partir de la instancia y la credencial efectiva y **valida que
  coincidan**: si difieren lanza `400` con mensaje claro. El modal muestra el ambiente
  resultante (solo lectura) y alerta/bloquea el guardado ante la inconsistencia.
- El nombre del backup usa el ambiente del evento (`{db}_{código}_{timestamp}`).
- **Columna Ambiente** en las tablas de *Backups* y *Ejecuciones*. La ejecución
  **snapshotea** el ambiente del evento al correr (`core.executions.environment`,
  migración `0014`, con backfill), para conservarlo en el historial.

## [Etapa 4 · parte 5] — Ambiente en credenciales · 2026-06-05

### Añadido
- **Credenciales** ganan campo **ambiente** (`secrets.credentials.environment`, migración
  `0012`): mismo selector `Nombre (CÓDIGO)` del catálogo, guarda el código como texto.

### Corregido
- **Edición de credenciales borraba el `extra` (y `description`)**: el `updateSchema`
  convertía los campos omitidos a `null`, de modo que un PATCH parcial —incluida la
  edición normal sin reescribir el `extra` guardado— limpiaba el secreto. Ahora en
  update **omitir = no tocar**, `null` explícito = limpiar.

## [Etapa 4 · parte 4] — Catálogo de ambientes · 2026-06-05

### Añadido
- **Módulo Ambientes** (`core.environments`, migraciones `0010`/`0011`): catálogo con
  **nombre** (etiqueta), **código** (PRD/UAT/DEV…, normalizado a mayúsculas y único ci),
  descripción y estado activo/inactivo. CRUD en `/api/environments` (reutiliza permisos
  `servers:*`, como buckets) y página propia. La migración **siembra** los ambientes ya
  usados en instancias.
- El modal de **instancia** usa ahora un **selector** que muestra `Nombre (CÓDIGO)` y
  guarda el **código**; `core.servers.environment` sigue siendo texto (sin FK). El
  nombre del backup usa ese código: `{db}_{código}_{timestamp}.sql[.gz]`. Borrar un
  ambiente en uso queda bloqueado con aviso.

## [Etapa 4 · parte 3] — Log, descarga, reintento y dumps por motor · 2026-06-05

### Añadido
- **Detalle de ejecución en la UI**: cada corrida es expandible y muestra, por BD,
  estado, peso, duración, **descarga del dump** y **log** del motor (cuando falló).
- **Descarga**: `GET /api/backups/executions/:execId/items/:itemId/download`
  (`backups:read`) — sirve el archivo con guard anti path-traversal y validación de
  que el ítem pertenece a la ejecución.
- **Reintento**: `POST /api/backups/executions/:execId/retry` (`backups:run`) — crea
  una nueva corrida del mismo evento con las mismas BDs registradas y dispara el motor.
- `ExecutionItemDto.log` se expone en la API para mostrar el error por BD.

### Cambiado
- **Organización de los dumps**: se guardan sueltos **por motor**
  (`backups/<motor>/<archivo>`) en vez de una carpeta por id de ejecución. El nombre
  ya identifica la corrida (`{db}_{ambiente}_{timestamp}`) y el id de ejecución queda
  como registro en `core.executions`.
- **Opciones del modal por motor**: el asistente muestra solo las opciones de dump
  aplicables al motor de la instancia (`ENGINE_BACKUP_OPTIONS` en shared). Hoy
  `compress` (postgres/mysql/mongo) y `excludeTables` (postgres/mysql); preparado para
  sumar motores sin reescribir el modal.

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
