import { Router } from "express";
import type { ApiOk } from "@dbkeeper/shared";
import { pool } from "../db/pool.js";

export const healthRouter: Router = Router();

/** Liveness: el proceso responde. */
healthRouter.get("/health", (_req, res) => {
  const body: ApiOk<{ status: "ok" }> = { ok: true, data: { status: "ok" } };
  res.json(body);
});

/** Readiness: además verifica conectividad con la BD de metadatos. */
healthRouter.get("/ready", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    const body: ApiOk<{ status: "ready"; db: "up" }> = {
      ok: true,
      data: { status: "ready", db: "up" },
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
