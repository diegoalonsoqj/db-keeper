import type { AuthIdentity } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import * as repo from "./credentials.repository.js";

/**
 * Quién puede combinar una credencial guardada con un destino. Conectar con ella
 * envía su contraseña al host de la instancia, así que apuntarla a un host propio
 * bastaría para capturarla. Pasa si el actor tiene `credentials:use`, si la
 * combinación ya existía (la instancia o un evento suyo ya la usan) o si la
 * contraseña la escribió el propio actor (ya la conoce).
 */
const canUseAny = (actor: AuthIdentity) => actor.permissions.includes("credentials:use");

async function isOwn(actor: AuthIdentity, credentialId: string): Promise<boolean> {
  return (await repo.getPasswordSetBy(credentialId)) === actor.user.id;
}

/** Usar la credencial con la instancia (`serverId` null = instancia nueva). */
export async function assertCanUseCredential(
  actor: AuthIdentity,
  credentialId: string | null | undefined,
  serverId: string | null,
): Promise<void> {
  if (!credentialId || canUseAny(actor)) return;
  if (serverId && (await repo.isLinkedToServer(credentialId, serverId))) return;
  if (await isOwn(actor, credentialId)) return;
  throw HttpError.forbidden(
    "No puedes usar esa credencial con esta instancia: su contraseña se enviaría a un destino donde aún no se usa. " +
      "Pide a un administrador que la asigne o el permiso credentials:use.",
  );
}

/** Cambiar el destino (host, puerto, motor…) de una instancia que usa estas credenciales. */
export async function assertCanRetarget(actor: AuthIdentity, credentialIds: (string | null)[]): Promise<void> {
  if (canUseAny(actor)) return;
  for (const id of new Set(credentialIds)) {
    if (id && !(await isOwn(actor, id))) {
      throw HttpError.forbidden(
        "No puedes cambiar host, puerto, motor u opciones de conexión de una instancia con credenciales guardadas: " +
          "sus contraseñas se enviarían al nuevo destino. Pide a un administrador el cambio o el permiso credentials:use.",
      );
    }
  }
}
