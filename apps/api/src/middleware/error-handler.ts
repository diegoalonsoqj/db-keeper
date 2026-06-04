import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiError } from "@dbkeeper/shared";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";
import { isProd } from "../config/env.js";

/** 404 para rutas no registradas. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = {
    ok: false,
    error: { code: "NOT_FOUND", message: "Ruta no encontrada" },
  };
  res.status(404).json(body);
};

/**
 * Manejo de errores centralizado. Traduce HttpError y ZodError a la respuesta
 * uniforme; cualquier otro error se reporta como 500 sin filtrar detalles
 * internos en producción.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiError = {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Entrada inválida", details: err.issues },
    };
    res.status(400).json(body);
    return;
  }

  req.log?.error({ err }, "Error no controlado");
  const body: ApiError = {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Error interno del servidor" : String((err as Error)?.message ?? err),
    },
  };
  res.status(500).json(body);
};
