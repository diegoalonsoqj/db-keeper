/**
 * Límite de intentos de login fallidos, en memoria. Válido porque la API corre como
 * una sola instancia (PM2 `instances: 1`); con varias instancias habría que moverlo a
 * Redis. Se cuenta por usuario y por IP: el de usuario protege cada cuenta (y evita
 * bloquear la cuenta de dominio en AD); el de IP frena barridos de muchos usuarios.
 */
export interface LimitPolicy {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
}

interface Entry {
  fails: number;
  firstAt: number;
  lockedUntil: number;
}

const entries = new Map<string, Entry>();

/** Milisegundos de bloqueo restantes para la clave (0 = no bloqueada). */
export function lockRemainingMs(key: string, now = Date.now()): number {
  const e = entries.get(key);
  return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
}

/** Registra un fallo; al alcanzar el máximo dentro de la ventana, bloquea la clave. */
export function registerFailure(key: string, policy: LimitPolicy, now = Date.now()): void {
  let e = entries.get(key);
  if (!e || now - e.firstAt > policy.windowMs) e = { fails: 0, firstAt: now, lockedUntil: 0 };
  e.fails++;
  if (e.fails >= policy.maxAttempts) {
    e.lockedUntil = now + policy.lockMs;
    e.fails = 0;
    e.firstAt = now;
  }
  entries.set(key, e);
}

/** Login correcto: olvida los fallos de la clave. */
export function resetKey(key: string): void {
  entries.delete(key);
}

// Limpieza periódica de entradas vencidas (sin bloqueo vigente y fuera de cualquier ventana).
const SWEEP_MS = 10 * 60_000;
const MAX_IDLE_MS = 24 * 60 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of entries) {
    if (e.lockedUntil <= now && now - e.firstAt > MAX_IDLE_MS) entries.delete(k);
  }
}, SWEEP_MS).unref();
