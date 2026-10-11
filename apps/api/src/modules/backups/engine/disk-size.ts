const GB = 1024 ** 3;
/** El tamaño automático se redondea hacia arriba a múltiplos de 100 GB. */
const ROUND_GB = 100;

export interface DiskSizeInput {
  /** Override del evento (GB); null = automático. */
  override: number | null;
  defaultSizeGb: number;
  maxSizeGb: number;
  sizeMarginPct: number;
  /** Mayor backup exitoso reciente (bytes) de las BDs del evento; null = sin historial. */
  lastBytes: number | null;
}

export interface DiskSizeResult {
  sizeGb: number;
  /** Motivo legible (para el log de la ejecución). */
  reason: string;
  /** Aviso si el último backup ocupa más del 80 % del disco elegido. */
  warning: string | null;
}

/**
 * Tamaño del disco temporal: el override del evento, o el mayor entre el tamaño
 * por defecto y el último backup × (1 + margen), redondeado a 100 GB y con tope.
 * El disco aloja una BD a la vez (se borra su carpeta tras subirla), así que manda
 * el backup más grande del evento.
 */
export function computeDiskSize(i: DiskSizeInput): DiskSizeResult {
  let sizeGb: number;
  let reason: string;
  if (i.override != null) {
    sizeGb = Math.min(i.override, i.maxSizeGb);
    reason = i.override > i.maxSizeGb ? `fijado en el evento (${i.override} GB), limitado al máximo` : "fijado en el evento";
  } else if (i.lastBytes != null && i.lastBytes > 0) {
    const needed = Math.ceil((i.lastBytes * (1 + i.sizeMarginPct / 100)) / GB / ROUND_GB) * ROUND_GB;
    sizeGb = Math.min(Math.max(i.defaultSizeGb, needed), i.maxSizeGb);
    reason =
      needed > i.maxSizeGb
        ? `último backup ${(i.lastBytes / GB).toFixed(0)} GB + ${i.sizeMarginPct} % pide ${needed} GB; limitado al máximo`
        : `último backup ${(i.lastBytes / GB).toFixed(0)} GB + ${i.sizeMarginPct} % de margen`;
  } else {
    sizeGb = i.defaultSizeGb;
    reason = "tamaño por defecto (sin historial)";
  }
  const usage = i.lastBytes != null ? i.lastBytes / (sizeGb * GB) : 0;
  const warning =
    usage > 0.8
      ? `El último backup (${(i.lastBytes! / GB).toFixed(0)} GB) ocupa el ${Math.round(usage * 100)} % del disco de ${sizeGb} GB: puede quedarse sin espacio. Sube el tamaño máximo o el del evento.`
      : null;
  return { sizeGb, reason, warning };
}
