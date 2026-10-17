import QRCode from "qrcode";
import type { TotpSetupDto } from "@dbkeeper/shared";
import { decryptSecret, encryptSecret } from "../../lib/crypto.js";
import { HttpError } from "../../lib/http-error.js";
import { verifyPassword } from "../../lib/password.js";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "../../lib/totp.js";
import * as usersRepo from "../users/users.repository.js";
import * as repo from "./totp.repository.js";

const ISSUER = "DBKeeper";

async function localUser(userId: string) {
  const user = await usersRepo.findById(userId);
  if (!user) throw HttpError.notFound("Usuario no encontrado");
  if (user.authType !== "local") {
    throw HttpError.badRequest("El segundo factor de los usuarios de AD lo gestiona el directorio");
  }
  return user;
}

/** Paso 1 de la activación: genera un secreto pendiente y su QR. */
export async function startTotpSetup(userId: string): Promise<TotpSetupDto> {
  const user = await localUser(userId);
  if (user.totpEnabled) throw HttpError.conflict("El segundo factor ya está activo");
  const secret = generateTotpSecret();
  if (!(await repo.savePendingSecret(userId, encryptSecret(secret)))) {
    throw HttpError.conflict("El segundo factor ya está activo");
  }
  const uri = otpauthUri(secret, user.username, ISSUER);
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, otpauthUri: uri, qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
}

/** Paso 2: confirma con un código de la app, activa y devuelve los códigos de recuperación (una sola vez). */
export async function confirmTotpSetup(userId: string, code: string): Promise<string[]> {
  await localUser(userId);
  const st = await repo.getTotpState(userId);
  if (!st?.secretEnc) throw HttpError.badRequest("Primero inicia la activación");
  if (st.enabled) throw HttpError.conflict("El segundo factor ya está activo");
  const step = verifyTotp(decryptSecret(st.secretEnc), code, null);
  if (step == null) throw HttpError.badRequest("Código incorrecto. Revisa la hora del teléfono e inténtalo de nuevo.");
  const codes = generateRecoveryCodes();
  await repo.enableTotp(userId, step, codes.map(hashRecoveryCode));
  return codes;
}

/**
 * Verifica el segundo factor: un código de 6 dígitos de la app o un código de
 * recuperación (que se consume). Devuelve el método usado, o null si no vale.
 */
export async function verifySecondFactor(userId: string, code: string): Promise<"totp" | "recovery" | null> {
  const st = await repo.getTotpState(userId);
  if (!st?.enabled || !st.secretEnc) return null;
  const c = code.trim();
  if (/^\d[\d\s]*$/.test(c)) {
    const step = verifyTotp(decryptSecret(st.secretEnc), c, st.lastStep);
    return step != null && (await repo.consumeStep(userId, step)) ? "totp" : null;
  }
  return (await repo.useRecoveryCode(userId, hashRecoveryCode(c))) ? "recovery" : null;
}

/** Desactivación por el propio usuario: pide contraseña y un código válido. */
export async function disableOwnTotp(userId: string, password: string, code: string): Promise<void> {
  await localUser(userId);
  const hash = await usersRepo.getPasswordHash(userId);
  if (!hash || !(await verifyPassword(password, hash))) throw HttpError.badRequest("La contraseña actual es incorrecta");
  if (!(await verifySecondFactor(userId, code))) throw HttpError.badRequest("Código incorrecto");
  await repo.disableTotp(userId);
}

export const recoveryCodesLeft = (userId: string) => repo.countRecoveryCodesLeft(userId);
