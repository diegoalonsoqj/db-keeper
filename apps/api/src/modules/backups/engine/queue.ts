import { logger } from "../../../config/logger.js";
import { query } from "../../../db/pool.js";
import { listenAsLeader } from "../../../lib/leader.js";
import { settleGroupRuns } from "../../groups/group-runs.service.js";
import { getBackupSettings } from "../../settings/settings.service.js";
import * as repo from "../backups.repository.js";
import { runExecution } from "./runner.js";

/**
 * Cola de ejecuciones. La cola es la propia BD: las ejecuciones `pending`, por
 * orden de creación (sobrevive a reinicios). Cada pasada lanza las que se pueden:
 *
 * - Una sola ejecución a la vez por instancia de origen (no se lee la misma BD dos
 *   veces en paralelo; en Cloud SQL, la instancia solo admite una operación).
 * - Los dumps corren en este servidor: como mucho `maxConcurrentDumps` a la vez.
 *   Los exports de Cloud SQL no cuentan (los genera la instancia en GCP).
 * - Un solo dump paralelo (`pg_parallel`) a la vez: su disco temporal se monta en
 *   una ruta única (Configuración → Disco temporal).
 */
const TICK_MS = 30_000;
/** Canal por el que una instancia seguidora avisa a la líder de que hay trabajo. */
const QUEUE_CHANNEL = "dbkeeper_queue";

/** Ejecuciones lanzadas por la cola y aún en curso en este proceso. */
const active = new Map<string, ActiveRun>();
let pumping = false;
let again = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Avisa a la cola de que hay una ejecución nueva (`pending`) para lanzar. Solo la
 * líder corre la cola: en una seguidora (la API que atendió el "Ejecutar") se avisa a
 * la líder por `pg_notify`; si el aviso se pierde, la recoge su pasada periódica.
 */
export function enqueueExecution(): void {
  if (timer) {
    void pump();
    return;
  }
  void query("SELECT pg_notify($1, '')", [QUEUE_CHANNEL]).catch((err) =>
    logger.warn({ err }, "No se pudo avisar a la instancia líder; la ejecución espera su próxima pasada"),
  );
}

interface ActiveRun {
  serverId: string | null;
  dump: boolean;
  /** Usa el disco temporal (pg_parallel). */
  scratch: boolean;
}

type Active = ReadonlyMap<string, ActiveRun>;

/**
 * Qué ejecuciones de la cola se pueden lanzar ya (en orden de llegada), dadas las
 * instancias ocupadas, las que están en curso y el límite de dumps simultáneos.
 */
export function selectRunnable(
  queued: repo.QueuedExecution[],
  busyServerIds: string[],
  running: Active,
  maxConcurrentDumps: number,
): ({ id: string } & ActiveRun)[] {
  const busy = new Set(busyServerIds);
  let dumps = 0;
  let scratchBusy = false;
  for (const a of running.values()) {
    if (a.serverId) busy.add(a.serverId);
    if (a.dump) dumps++;
    if (a.scratch) scratchBusy = true;
  }
  const out: ({ id: string } & ActiveRun)[] = [];
  for (const q of queued) {
    if (running.has(q.id)) continue;
    if (q.serverId && busy.has(q.serverId)) continue;
    // Sin evento (serverId null) no consume hueco: el runner la cierra como fallida.
    const dump = q.serverId !== null && q.method !== "cloudsql_export";
    const scratch = q.serverId !== null && q.method === "pg_parallel";
    if (dump && dumps >= maxConcurrentDumps) continue;
    if (scratch && scratchBusy) continue;
    if (scratch) scratchBusy = true;
    if (dump) dumps++;
    if (q.serverId) busy.add(q.serverId);
    out.push({ id: q.id, serverId: q.serverId, dump, scratch });
  }
  return out;
}

async function pump(): Promise<void> {
  // Una sola pasada a la vez; si llega otro aviso mientras tanto, se repite al final.
  if (pumping) {
    again = true;
    return;
  }
  pumping = true;
  try {
    do {
      again = false;
      const [queued, busyIds, { maxConcurrentDumps }] = await Promise.all([
        repo.listQueuedExecutions(),
        repo.findBusyServerIds(),
        getBackupSettings(),
      ]);
      for (const r of selectRunnable(queued, busyIds, active, maxConcurrentDumps)) start(r);
    } while (again);
  } catch (err) {
    logger.error({ err }, "Fallo en la cola de ejecuciones");
  } finally {
    pumping = false;
  }
  // Resumen de las corridas de grupo que ya terminaron (fin, cancelación o reinicio).
  await settleGroupRuns();
}

function start({ id, ...run }: { id: string } & ActiveRun): void {
  active.set(id, run);
  void runExecution(id)
    .catch((err) => logger.error({ err, executionId: id }, "Error al disparar el motor"))
    .finally(() => {
      active.delete(id);
      void pump(); // libera hueco/instancia: lanzar la siguiente
    });
}

/**
 * Arranca la cola: una pasada inmediata (ejecuciones que quedaron en cola antes de
 * un reinicio) y otra periódica, por si se libera una instancia fuera de la cola
 * (p. ej. al terminar un export retomado) o cambia el límite en Configuración.
 */
export function startExecutionQueue(): void {
  if (timer) return;
  timer = setInterval(() => void pump(), TICK_MS);
  timer.unref();
  void pump();
  void listenAsLeader(QUEUE_CHANNEL, () => void pump()).catch((err) =>
    logger.error({ err }, "No se pudo escuchar los avisos de la cola; se usará solo la pasada periódica"),
  );
}
