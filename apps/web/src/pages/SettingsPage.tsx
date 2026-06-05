import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_LOCALES,
  type AppLocale,
  type CloudCredentialDto,
  type Paginated,
  type SettingsDto,
  type StorageTargetDto,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

export function SettingsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("settings:write");

  const [data, setData] = useState<SettingsDto | null>(null);
  const [targets, setTargets] = useState<StorageTargetDto[]>([]);
  const [accounts, setAccounts] = useState<CloudCredentialDto[]>([]);
  const [bindPassword, setBindPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SettingsDto>("/settings")
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
    api
      .get<Paginated<StorageTargetDto>>("/storage?limit=100")
      .then((p) => setTargets(p.items))
      .catch(() => {});
    api
      .get<Paginated<CloudCredentialDto>>("/cloud-credentials?limit=100")
      .then((p) => setAccounts(p.items))
      .catch(() => {});
  }, []);

  async function setDefaultTarget(id: string) {
    await api.post(`/storage/${id}/default`);
    const p = await api.get<Paginated<StorageTargetDto>>("/storage?limit=100");
    setTargets(p.items);
  }
  async function setDefaultAccount(id: string) {
    await api.post(`/cloud-credentials/${id}/default`);
    const p = await api.get<Paginated<CloudCredentialDto>>("/cloud-credentials?limit=100");
    setAccounts(p.items);
  }
  const defaultOf = (ty: StorageTargetDto["type"]) =>
    targets.find((s) => s.type === ty && s.isDefault)?.id ?? "";
  const defaultAccount = accounts.find((a) => a.provider === "gcp" && a.isDefault)?.id ?? "";

  function notify(fn: () => Promise<unknown>) {
    setError(null);
    setMsg(null);
    fn()
      .then(() => setMsg(t("settings.saved")))
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }

  if (!data) return <p className="muted">{error ?? t("common.loading")}</p>;

  const g = data.general;
  const l = data.ldap;

  async function saveGeneral() {
    const next = await api.patch<SettingsDto["general"]>("/settings/general", g);
    setData((d) => (d ? { ...d, general: next } : d));
  }

  async function saveLdap() {
    const payload = { ...l, ...(bindPassword ? { bindPassword } : {}) } as Record<string, unknown>;
    delete payload.hasBindPassword;
    const next = await api.patch<SettingsDto["ldap"]>("/settings/ldap", payload);
    setBindPassword("");
    setData((d) => (d ? { ...d, ldap: next } : d));
  }

  return (
    <section>
      {error && <p className="error">{error}</p>}
      {msg && <p className="success">{msg}</p>}

      <div className="card form-card">
        <h2>{t("settings.general")}</h2>
        <label>
          {t("settings.timezone")}
          <input
            value={g.timezone}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, general: { ...g, timezone: e.target.value } })}
          />
        </label>
        <label>
          {t("settings.defaultLanguage")}
          <select
            value={g.defaultLanguage}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, general: { ...g, defaultLanguage: e.target.value as AppLocale } })}
          >
            {APP_LOCALES.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
        {canWrite && (
          <div className="form-actions">
            <button onClick={() => notify(saveGeneral)}>{t("common.save")}</button>
          </div>
        )}
      </div>

      <div className="card form-card" style={{ marginTop: "1rem" }}>
        <h2>{t("settings.storageDefaults")}</h2>
        <p className="muted">{t("settings.storageDefaultsHint")}</p>
        <label>
          {t("settings.defaultLocal")}
          <select
            value={defaultOf("local")}
            disabled={!canWrite}
            onChange={(e) => e.target.value && notify(() => setDefaultTarget(e.target.value))}
          >
            <option value="" disabled>
              {t("common.none")}
            </option>
            {targets
              .filter((s) => s.type === "local")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("settings.defaultBucket")}
          <select
            value={defaultOf("bucket")}
            disabled={!canWrite}
            onChange={(e) => e.target.value && notify(() => setDefaultTarget(e.target.value))}
          >
            <option value="" disabled>
              {t("common.none")}
            </option>
            {targets
              .filter((s) => s.type === "bucket")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t("settings.defaultGcp")}
          <select
            value={defaultAccount}
            disabled={!canWrite}
            onChange={(e) => e.target.value && notify(() => setDefaultAccount(e.target.value))}
          >
            <option value="" disabled>
              {t("common.none")}
            </option>
            {accounts
              .filter((a) => a.provider === "gcp")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="card form-card" style={{ marginTop: "1rem" }}>
        <h2>{t("settings.ldap")}</h2>
        <label className="inline">
          <input
            type="checkbox"
            checked={l.enabled}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, enabled: e.target.checked } })}
          />
          {t("settings.ldapEnabled")}
        </label>
        <label>
          {t("settings.ldapUrl")}
          <input
            value={l.url}
            disabled={!canWrite}
            placeholder="ldaps://dc.empresa.com:636"
            onChange={(e) => setData({ ...data, ldap: { ...l, url: e.target.value } })}
          />
        </label>
        <label>
          {t("settings.ldapBindDn")}
          <input
            value={l.bindDn}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, bindDn: e.target.value } })}
          />
        </label>
        <label>
          {t("settings.ldapBindPassword")}
          <input
            type="password"
            value={bindPassword}
            disabled={!canWrite}
            placeholder={l.hasBindPassword ? "••••••••" : ""}
            onChange={(e) => setBindPassword(e.target.value)}
          />
          <small>{t("settings.ldapBindPasswordHint")}</small>
        </label>
        <label>
          {t("settings.ldapSearchBase")}
          <input
            value={l.searchBase}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, searchBase: e.target.value } })}
          />
        </label>
        <label>
          {t("settings.ldapUserFilter")}
          <input
            value={l.userFilter}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, userFilter: e.target.value } })}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={l.tlsRejectUnauthorized}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, tlsRejectUnauthorized: e.target.checked } })}
          />
          {t("settings.ldapTls")}
        </label>
        {canWrite && (
          <div className="form-actions">
            <button onClick={() => notify(saveLdap)}>{t("common.save")}</button>
          </div>
        )}
      </div>
    </section>
  );
}
