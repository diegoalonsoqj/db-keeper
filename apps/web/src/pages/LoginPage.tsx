import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiClientError } from "../lib/api";
import { postLoginTarget } from "../lib/redirect";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ThemeToggle } from "../components/ThemeToggle";
import { BrandLogo } from "../components/BrandLogo";

export function LoginPage() {
  const { t } = useTranslation();
  const { login, verifyTotp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Segundo paso: la contraseña fue correcta y falta el código de la app.
  const [mfa, setMfa] = useState(false);
  const [code, setCode] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mfa) {
        await verifyTotp(code);
      } else if ((await login(username, password)) === "mfa") {
        setMfa(true);
        return;
      }
      // Vuelve a la página pedida antes del login (p. ej. un enlace con filtros).
      navigate(postLoginTarget(location.state), { replace: true });
    } catch (err) {
      // El desafío venció: se vuelve a pedir la contraseña.
      if (mfa && err instanceof ApiClientError && err.code === "MFA_EXPIRED") {
        setMfa(false);
        setCode("");
      }
      setError(err instanceof ApiClientError ? err.message : t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1 className="login-brand">
          <BrandLogo size={48} />
          {t("app.name")}
        </h1>
        <p className="tagline">{t("app.tagline")}</p>
        {mfa ? (
          <>
            <p className="muted">{t("login.totpHint")}</p>
            <label>
              {t("login.totpCode")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={20}
                autoFocus
                required
              />
            </label>
          </>
        ) : (
          <>
            <label>
              {t("login.username")}
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </label>
            <label>
              {t("login.password")}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? t("common.loading") : mfa ? t("login.verify") : t("login.submit")}
        </button>
        {mfa && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setMfa(false);
              setCode("");
              setError(null);
            }}
          >
            {t("login.back")}
          </button>
        )}
        <div className="login-lang">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}
