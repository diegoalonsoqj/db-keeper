import { pino } from "pino";
import { env, isProd } from "./env.js";

/**
 * Logging estructurado (pino). En desarrollo usa pino-pretty para legibilidad;
 * en producción emite JSON. Nunca loguear secretos ni PII: las rutas sensibles
 * se redactan aquí.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.token",
      "*.secret",
      "*.master_key",
    ],
    censor: "[redacted]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }),
});
