import { stat } from "node:fs/promises";
import type { SizeSource } from "./supervise.js";

/**
 * Vigila el tamaño de un archivo en curso y reporta cada cambio. Pensado para el
 * progreso en vivo de un dump (el archivo de salida va creciendo). Best-effort:
 * si el archivo aún no existe o falla el `stat`, simplemente no reporta. Devuelve
 * una función para detener la vigilancia (idempotente).
 */
export function watchFileSize(
  output: SizeSource,
  onBytes: (bytes: number) => void,
  intervalMs = 2000,
): () => void {
  const sizeOf = typeof output === "string" ? () => stat(output).then((s) => s.size) : output;
  let last = -1;
  const timer = setInterval(() => {
    void sizeOf()
      .then((size) => {
        if (size !== last) {
          last = size;
          onBytes(size);
        }
      })
      .catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
