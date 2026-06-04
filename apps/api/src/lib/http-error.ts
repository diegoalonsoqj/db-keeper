/**
 * Error HTTP tipado/clasificado. Los servicios lanzan estos errores y el
 * middleware central los traduce a la respuesta uniforme `ApiError`.
 * Evita try/catch vacíos que traguen fallos (CLAUDE.md §3).
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "No autenticado"): HttpError {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Sin permisos"): HttpError {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Recurso no encontrado"): HttpError {
    return new HttpError(404, "NOT_FOUND", message);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, "CONFLICT", message, details);
  }
}
