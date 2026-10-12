/**
 * Lectura común de los errores de las APIs REST de GCP (gaxios/google-auth-library).
 * Distingue el fallo al obtener el token (antes de llamar a la API) del error que
 * devuelve la propia API, y añade una pista accionable para los 401.
 */
interface GaxiosLikeError {
  message?: string;
  response?: {
    status?: number;
    // API: { error: { message } } · endpoint OAuth: { error: "invalid_grant", error_description }
    data?: unknown;
  };
}

export interface GcpErrorInfo {
  status: number | null;
  message: string;
  /** Pista para 401 (credencial rechazada); "" si no aplica. */
  authHint: string;
}

function dataMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const err = (data as { error?: unknown; error_description?: unknown }).error;
  if (typeof err === "object" && err !== null) {
    const msg = (err as { message?: unknown }).message;
    return typeof msg === "string" && msg ? msg : null;
  }
  if (typeof err === "string" && err) {
    const desc = (data as { error_description?: unknown }).error_description;
    return typeof desc === "string" && desc ? `${err}: ${desc}` : err;
  }
  return null;
}

export function describeGcpError(err: unknown, serviceAccountJson: string | null): GcpErrorInfo {
  const e = err as GaxiosLikeError;
  const status = e.response?.status ?? null;
  const message = dataMessage(e.response?.data) ?? e.message ?? String(err);
  let authHint = "";
  if (status === 401) {
    // Sin clave se autentica con ADC: en una VM, el servidor de metadatos emite el token.
    authHint = serviceAccountJson
      ? " (Google rechazó la clave de la service account: puede estar borrada o rotada, o la cuenta deshabilitada; genera una clave nueva y actualízala en Cuentas de servicio)"
      : " (se autenticó con la cuenta de la VM / ADC y no se obtuvo token: revisa que la VM tenga cuenta de servicio con alcance cloud-platform, que un proxy no intercepte metadata.google.internal / 169.254.169.254 (agrégalos a NO_PROXY), o asigna a la instancia una cuenta con clave JSON)";
  }
  return { status, message, authHint };
}
