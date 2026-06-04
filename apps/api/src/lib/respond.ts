import type { Response } from "express";
import type { ApiOk } from "@dbkeeper/shared";

/** Envía la respuesta uniforme de éxito. */
export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { ok: true, data };
  res.status(status).json(body);
}
