/**
 * Cancelación de ejecuciones en curso en este proceso. Hoy solo la registra el
 * dump paralelo (`pg_parallel`): su dump puede durar horas con un disco temporal
 * facturándose, así que debe poder detenerse (y liberar el disco) a demanda.
 */
const controllers = new Map<string, { controller: AbortController; reason: string | null }>();

/** Registra una ejecución cancelable; devuelve su señal. */
export function registerCancellable(executionId: string): AbortSignal {
  const entry = { controller: new AbortController(), reason: null };
  controllers.set(executionId, entry);
  return entry.controller.signal;
}

export function unregisterCancellable(executionId: string): void {
  controllers.delete(executionId);
}

/** ¿La ejecución se puede cancelar desde este proceso? */
export function isCancellable(executionId: string): boolean {
  return controllers.has(executionId);
}

/** Pide la cancelación; false si la ejecución no está en curso aquí. */
export function requestCancel(executionId: string, reason: string): boolean {
  const entry = controllers.get(executionId);
  if (!entry || entry.controller.signal.aborted) return false;
  entry.reason = reason;
  entry.controller.abort();
  return true;
}

/** Motivo registrado al cancelar (p. ej. "Cancelada por admin"). */
export function cancelReason(executionId: string): string | null {
  return controllers.get(executionId)?.reason ?? null;
}

/** Ejecuciones registradas (cancelables) en este proceso. */
export function activeCancellableIds(): Set<string> {
  return new Set(controllers.keys());
}
