import { stat } from "node:fs/promises";

/**
 * Vigila el tamaño de un archivo en curso y reporta cada cambio. Pensado para el
 * progreso en vivo de un dump (el archivo de salida va creciendo). Best-effort:
 * si el archivo aún no existe o falla el `stat`, simplemente no reporta. Devuelve
 * una función para detener la vigilancia (idempotente).
 */
export function watchFileSize(
  filePath: string,
  onBytes: (bytes: number) => void,
  intervalMs = 2000,
): () => void {
  let last = -1;
  const timer = setInterval(() => {
    void stat(filePath)
      .then((s) => {
        if (s.size !== last) {
          last = s.size;
          onBytes(s.size);
        }
      })
      .catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
