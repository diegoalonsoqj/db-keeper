import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TotpSetupDto } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { api, ApiClientError } from "../lib/api";
import { useToast } from "./Toast";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

/** Segundo factor (TOTP) del propio usuario local: activar con QR, ver códigos, desactivar. */
export function TotpSection() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<{ enabled: boolean; recoveryCodesLeft: number } | null>(null);
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<{ enabled: boolean; recoveryCodesLeft: number }>("/auth/totp")
      .then(setStatus)
      .catch((e) => toast.error(errMsg(e)));

  useEffect(() => {
    void load();
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => setSetup(await api.post<TotpSetupDto>("/auth/totp/setup")));

  const confirm = () =>
    run(async () => {
      const r = await api.post<{ recoveryCodes: string[] }>("/auth/totp/enable", { code });
      setRecovery(r.recoveryCodes);
      setSetup(null);
      setCode("");
      toast.success(t("totp.enabled"));
    });

  const finish = () =>
    run(async () => {
      setRecovery(null);
      await Promise.all([refresh(), load()]);
    });

  const disable = () =>
    run(async () => {
      await api.post("/auth/totp/disable", { code, password });
      setCode("");
      setPassword("");
      toast.success(t("totp.disabled"));
      await Promise.all([refresh(), load()]);
    });

  if (!status) return null;

  return (
    <>
      <hr className="sep" />
      <h3>{t("totp.title")}</h3>

      {recovery ? (
        <>
          <p>{t("totp.recoveryIntro")}</p>
          <pre className="totp-recovery">{recovery.join("\n")}</pre>
          <div className="form-actions">
            <button
              className="secondary"
              onClick={() => void navigator.clipboard?.writeText(recovery.join("\n")).then(() => toast.success(t("totp.copied")))}
            >
              {t("totp.copy")}
            </button>
            <button onClick={finish} disabled={busy}>
              {t("totp.saved")}
            </button>
          </div>
        </>
      ) : status.enabled ? (
        <>
          <p className="muted">{t("totp.activeInfo", { count: status.recoveryCodesLeft })}</p>
          <div className="form-grid">
            <label>
              {t("profile.currentPassword")}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              {t("totp.codeOrRecovery")}
              <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} />
            </label>
          </div>
          <div className="form-actions">
            <button className="danger" onClick={disable} disabled={busy || !password || code.trim().length < 6}>
              {t("totp.disable")}
            </button>
          </div>
        </>
      ) : setup ? (
        <>
          <p>{t("totp.scan")}</p>
          <div className="totp-setup">
            <img src={setup.qrDataUrl} alt="QR" width={180} height={180} />
            <div>
              <p className="muted">{t("totp.manual")}</p>
              <code className="totp-secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            </div>
          </div>
          <div className="form-grid">
            <label>
              {t("totp.code")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="secondary" onClick={() => setSetup(null)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button onClick={confirm} disabled={busy || !/^\d{6}$/.test(code.trim())}>
              {t("totp.confirm")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{t("totp.offInfo")}</p>
          <div className="form-actions">
            <button onClick={start} disabled={busy}>
              {t("totp.enable")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
