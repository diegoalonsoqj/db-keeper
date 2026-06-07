import { useEffect, useRef } from "react";
import type { BackupStreamEvent, ExecutionDto } from "@dbkeeper/shared";

interface Handlers {
  /** Snapshot de una ejecución que cambió de estado (reemplazar por `id`). */
  onEvent: (execution: ExecutionDto) => void;
  /** Líneas de consola en vivo de una BD de la ejecución. */
  onLog?: (log: { executionId: string; dbName: string; lines: string[] }) => void;
  /** Tamaño actual (bytes) del dump en curso de una BD, para progreso en vivo. */
  onProgress?: (p: { executionId: string; dbName: string; bytes: number }) => void;
  /** Cambio de estado de la conexión: `true` al (re)conectar, `false` al caer. */
  onStatus?: (connected: boolean) => void;
}

/**
 * Suscribe el progreso de las ejecuciones por SSE (`/backups/executions/stream`).
 * La conexión se abre una sola vez; `EventSource` reconecta solo. Los manejadores
 * se leen por ref, así que pueden cambiar de identidad entre renders sin reabrir
 * la conexión. Ver `docs/REALTIME-QUEUE-DESIGN.md`.
 */
export function useExecutionStream(handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      ref.current.onStatus?.(false); // sin soporte: el consumidor cae a poll
      return;
    }
    let closed = false;
    const es = new EventSource("/api/backups/executions/stream", { withCredentials: true });

    es.onopen = () => ref.current.onStatus?.(true);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as BackupStreamEvent;
        if (evt.type === "execution-updated") ref.current.onEvent(evt.execution);
        else if (evt.type === "execution-log")
          ref.current.onLog?.({ executionId: evt.executionId, dbName: evt.dbName, lines: evt.lines });
        else if (evt.type === "execution-progress")
          ref.current.onProgress?.({ executionId: evt.executionId, dbName: evt.dbName, bytes: evt.bytes });
      } catch {
        /* líneas de comentario/heartbeat no son JSON: se ignoran */
      }
    };
    es.onerror = () => {
      if (!closed && es.readyState !== EventSource.OPEN) ref.current.onStatus?.(false);
    };

    return () => {
      closed = true;
      es.close();
    };
  }, []);
}
