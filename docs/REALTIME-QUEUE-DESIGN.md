# Diseño: tiempo real (SSE) + cola Redis (BullMQ)

> Estado: **propuesta de diseño** (no implementado). Fecha: 2026-06-06.
> Objetivo: empujar el progreso de las ejecuciones de backup en vivo y, opcionalmente,
> mover la ejecución a una cola durable. Las dos partes son **independientes** y la cola
> es **aditiva con degradación elegante** (sin `REDIS_URL` todo funciona como hoy).

## 1. Principios

1. **Desacoplar las dos fases**: SSE (Fase A) no depende de Redis; la cola (Fase B) reusa
   el mismo canal de eventos.
2. **Degradación elegante**: sin `REDIS_URL`, todo funciona como hoy (in-proceso). Redis es
   aditivo, nunca requisito.
3. **Sin tocar auth**: SSE viaja sobre la cookie httpOnly existente; CORS ya tiene
   `credentials:true` y `origin:true`.
4. **Cambios quirúrgicos en el runner**: la lógica de dump no cambia; solo se le añade
   "emitir evento" en los puntos donde ya escribe estado.

## 2. Estado actual (punto de partida)

- **Runner** (`modules/backups/engine/runner.ts`): in-proceso, *fire-and-forget*
  (`void runExecution`). Un reinicio/deploy mata las corridas en curso →
  `recoverStaleExecutions` las marca `failed` al arrancar.
- **Progreso en UI** (`apps/web/src/pages/ExecutionsPage.tsx`): *poll* cada 3 s mientras
  haya alguna ejecución `pending`/`running`.
- **Redis**: `REDIS_URL` existe en `env.ts` (opcional) y en `.env.example`, pero **no hay
  Redis corriendo en dev** ni deps (`ioredis`/`bullmq`/`ws`).
- **Transporte recomendado: SSE, no WebSocket.** El progreso es unidireccional
  (server→cliente); `EventSource` es nativo, se reconecta solo y usa la cookie httpOnly
  existente (con WS y headers habría fricción de auth). WS solo se justificaría con
  interacción bidireccional (consola en vivo); incluso "cancelar corrida" se resuelve con
  un endpoint REST.

## 3. Modelo de eventos

Un único tipo, **snapshot completo por transición** (evita lógica frágil de *merge*
parcial; la frecuencia es baja: ~2 + 2×nBDs eventos por corrida):

```ts
// shared/resources.ts
export interface BackupStreamEvent {
  type: "execution-updated";
  execution: ExecutionDto; // estado completo tras la transición
}
```

Puntos de emisión en `runner.ts` (donde ya se escribe en BD):
- tras `markExecutionRunning` → running
- tras cada `markItemRunning` y cada `finishItem`
- tras `finishExecution` → estado final
- en `fail(...)` (fallos de pre-vuelo)

Cada emisión: `publishEvent({ type: "execution-updated", execution: await repo.findExecutionById(id) })`.

## 4. Fase A — SSE in-proceso (sin Redis)

### 4.1 Bus de eventos — `modules/backups/events.ts` (nuevo)

```ts
import { EventEmitter } from "node:events";
import type { BackupStreamEvent } from "@dbkeeper/shared";

const bus = new EventEmitter();
bus.setMaxListeners(0); // 1 listener por conexión SSE

export function publishEvent(evt: BackupStreamEvent): void {
  bus.emit("event", evt);                 // Fase A: local
  // Fase B inyectará aquí el publish a Redis (ver §5.3)
}
export function subscribe(fn: (e: BackupStreamEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
```

> El runner importa `publishEvent` de `events.ts` (no de la cola) → **sin dependencia de
> Redis** y sin ciclos.

### 4.2 Endpoint SSE — en `backups.routes.ts`

```
GET /api/backups/executions/stream   (authorize("backups:read"))
```

Detalles:
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`; `res.flushHeaders()`.
- **Auth**: el middleware `authenticate` ya valida la cookie (EventSource la manda con
  `withCredentials`).
- Al conectar: `subscribe(...)` y escribir `data: ${JSON.stringify(evt)}\n\n` por evento.
- **Heartbeat**: comentario `: ping\n\n` cada ~25 s (evita cortes de proxies / idle
  timeout). `interval.unref()`.
- **Limpieza**: `req.on("close", () => { unsubscribe(); clearInterval(heartbeat); })`.
- **No comprimir** esta ruta (hoy no hay middleware de compresión, así que OK; dejar nota).
- Va **antes** de `/:id` (como `/executions`) para que el router no lo capture.

> Alcance: stream global de las ejecuciones (el front filtra/mergea por `id`). Opción
> `?jobId=` para acotar, pero no es necesario al inicio.

### 4.3 Cliente web — `apps/web`

- Nuevo hook `useExecutionStream(onEvent)`:
  - Abre `new EventSource(`${API}/backups/executions/stream`, { withCredentials: true })`.
  - `onmessage`: parsea y llama `onEvent(execution)`.
  - **Resync en (re)conexión**: en `onopen`, dispara un refetch REST de la lista (cubre
    eventos perdidos durante la desconexión). EventSource reconecta solo.
  - **Fallback**: si `EventSource` falla repetidamente (`onerror` con
    `readyState===CLOSED`), cae al `setInterval` de poll actual.
- `ExecutionsPage`: sustituye el `setInterval(POLL_MS)` por el hook; `onEvent` hace *merge*
  del snapshot en `data.items` (reemplaza por `id`; si no está y está en la página,
  refetch). Mantiene un **poll de seguridad lento** (p. ej. 30 s) como red de seguridad. La
  paginación sigue por REST.

### 4.4 Coste Fase A

~1 archivo nuevo (`events.ts`) + ~30 líneas en routes + ~5 emisiones en runner + 1 hook web
+ ajuste de `ExecutionsPage` + 1 tipo en shared. **Sin deps nuevas, sin infra.**

## 5. Fase B — BullMQ + Redis (aditiva)

### 5.1 Abstracción de despacho — `modules/backups/dispatch.ts` (nuevo)

El service deja de llamar `void runExecution(id)` y llama `dispatchExecution(id)`:

```ts
export async function dispatchExecution(executionId: string): Promise<void> {
  if (queueEnabled()) await enqueue(executionId);   // BullMQ
  else void runExecution(executionId).catch(log);   // in-proceso (hoy)
}
```

`queueEnabled()` = `!!env.REDIS_URL`. **Un solo punto de bifurcación**;
`runNow/runScheduled/retryExecution` quedan idénticos salvo la llamada.

### 5.2 Cola y worker

- Dep: `bullmq` + `ioredis`. Cola `backups`, job `{ executionId }`, `jobId = executionId`
  (**idempotencia**: BullMQ ignora duplicados; reemplaza al `inFlight Set` actual).
- Worker: `new Worker("backups", processor, { concurrency: env.BACKUP_CONCURRENCY ?? 1 })`.
  El `processor` llama al **mismo `runExecution`** existente.
- **Dónde corre el worker**: por defecto en el proceso API (flag
  `BACKUP_WORKER_INLINE=true`), con opción de proceso separado (`apps/api/src/worker.ts` +
  script `start:worker`) para escalar. El runner ya es agnóstico al proceso.
- Reintentos: `attempts`/`backoff` de BullMQ para fallos **de infraestructura**; los fallos
  de dump siguen reflejándose como `failed` en BD (no reintentar dumps automáticamente sin
  pedirlo — semántica de negocio).

### 5.3 Puente pub/sub ↔ bus

- En `publishEvent` (§4.1): si Redis, además
  `redisPub.publish("backups:events", JSON.stringify(evt))`.
- Al arrancar la **API** con Redis: un `redisSub.subscribe("backups:events")` que reinyecta
  cada mensaje en el `bus` local → **el endpoint SSE no cambia** y funciona aunque el worker
  sea otro proceso.

### 5.4 Relación con el scheduler y recoverStale

- **Scheduler** (`scheduler.ts`): se mantiene (es timezone-aware y ya funciona). En vez de
  `runScheduled`→`void runExecution`, hace `runScheduled`→`createExecution`+
  `dispatchExecution`. *(Alternativa: repeatable jobs de BullMQ; descartada por ahora —
  reescribir el manejo de zona horaria no compensa.)*
- **recoverStaleExecutions**: con cola, deja de marcar `failed` indiscriminado; las corridas
  siguen en la cola tras un reinicio (**durabilidad**, el objetivo). Se ajusta para marcar
  `failed` solo lo que no esté ni en la cola ni activo.

### 5.5 Config/env nuevas

- `REDIS_URL` (ya existe).
- `BACKUP_WORKER_INLINE` (def `true`), `BACKUP_CONCURRENCY` (def `1`). `.env.example` +
  validación Zod en `env.ts`.

## 6. Fiabilidad / seguridad

- **Idempotencia**: `jobId = executionId` (cola) o `inFlight Set` (in-proceso) evitan
  disparos dobles.
- **Auth SSE**: misma cookie + `authorize("backups:read")`. Sin exponer secretos (los
  eventos solo llevan `ExecutionDto`, que ya es público).
- **Conexiones SSE**: 1 por pestaña; aceptable para uso interno. Cerrar en `req.close` y
  documentar el límite.
- **Backpressure**: con cola, `concurrency` limita dumps simultáneos (hoy no hay límite
  real).
- **Cierre ordenado**: `shutdown` (en `index.ts`) debe cerrar worker/conexiones Redis además
  del `server`/pool.

## 7. Cambios por archivo

| Archivo | Fase | Cambio |
|---|---|---|
| `shared/resources.ts` | A | `BackupStreamEvent` |
| `modules/backups/events.ts` | A | **nuevo**: bus + publish/subscribe |
| `engine/runner.ts` | A | ~5 `publishEvent(...)` en transiciones |
| `backups.routes.ts` | A | endpoint SSE `/executions/stream` |
| `apps/web` hook + `ExecutionsPage.tsx` | A | EventSource + merge + fallback poll |
| `config/env.ts`, `.env.example` | B | `BACKUP_WORKER_INLINE`, `BACKUP_CONCURRENCY` |
| `modules/backups/dispatch.ts` | B | **nuevo**: `dispatchExecution`/`queueEnabled` |
| `modules/backups/queue.ts` + `worker` | B | **nuevo**: cola, worker, pub/sub |
| `backups.service.ts` | B | `void runExecution`→`dispatchExecution` (3 sitios) |
| `engine/runner.ts` (recover) + `scheduler.ts` | B | recover ajustado; scheduler encola |
| `index.ts` | B | arrancar worker inline + sub Redis; cerrar en shutdown |
| docs (`API.md`, `ARCHITECTURE.md`), `CHANGELOG` | A/B | documentar |

## 8. Rollout y riesgos

- **Fase A** sola ya entrega el progreso en vivo; mergeable sin Redis ni cambios de infra.
  Riesgo bajo.
- **Fase B** requiere Redis en runtime; con el fallback, su ausencia no rompe nada (vuelve a
  Fase A). Riesgo medio (nueva infra, cierre ordenado, recover).
- **e2e Fase B** queda **pendiente de Redis** (hoy no hay en dev) — al implementarla habría
  que levantarlo (p. ej. `docker run -p 6379:6379 redis`).

## 9. Decisiones (propuestas, pendientes de confirmar)

1. **Snapshot completo por transición** vs *delta* por ítem → propuesto **snapshot** (más
   simple/robusto).
2. **Stream global** vs por `jobId` → propuesto **global** con filtrado en cliente.
3. **Worker inline por defecto** (mismo proceso) con opción a separado → propuesto
   **inline**.
4. **Mantener el scheduler** (que encola) en vez de repeatable jobs de BullMQ → propuesto
   **mantenerlo**.

## 10. Orden de implementación sugerido

1. Fase A completa (SSE + cliente) y verificación e2e local (sin Redis).
2. Fase B cuando haya Redis disponible: `dispatch.ts` + cola/worker + puente pub/sub +
   ajustes de scheduler/recover, con fallback verificado (apagar Redis → vuelve a Fase A).
