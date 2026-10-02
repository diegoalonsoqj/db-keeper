import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_LOCALES,
  EMAIL_PROVIDERS,
  LDAP_MODES,
  LDAP_SECURITY,
  type AppLocale,
  type CloudCredentialDto,
  type EmailProvider,
  type LdapMode,
  type LdapSecurity,
  type LdapTestResultDto,
  type Paginated,
  type SettingsDto,
  type StorageTargetDto,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { optionLabel } from "../lib/options";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

type ChannelTest = { ok: boolean | null; error?: string };
type NotifTestResult = { email: ChannelTest; telegram: ChannelTest };

export function SettingsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("settings:write");
  const toast = useToast();

  const [data, setData] = useState<SettingsDto | null>(null);
  const [targets, setTargets] = useState<StorageTargetDto[]>([]);
  const [accounts, setAccounts] = useState<CloudCredentialDto[]>([]);
  const [bindPassword, setBindPassword] = useState("");
  // "Probar AD": credenciales de prueba (no se guardan) y resultado.
  const [ldapTestUser, setLdapTestUser] = useState("");
  const [ldapTestPass, setLdapTestPass] = useState("");
  const [ldapTest, setLdapTest] = useState<LdapTestResultDto | null>(null);
  const [ldapTesting, setLdapTesting] = useState(false);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [apiAuth, setApiAuth] = useState("");
  const [botToken, setBotToken] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<
    "general" | "storage" | "backups" | "ldap" | "security" | "notifications"
  >("general");

  useEffect(() => {
    api
      .get<SettingsDto>("/settings")
      .then((s) => {
        setData(s);
        setRecipientsText(s.notifications.email.recipients.join(", "));
      })
      .catch((e) => setLoadError(errMsg(e)));
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
    fn()
      .then(() => toast.success(t("settings.saved")))
      .catch((e) => toast.error(errMsg(e)));
  }

  if (!data) return <p className="muted">{loadError ?? t("common.loading")}</p>;

  const g = data.general;
  const l = data.ldap;
  const sec = data.security;
  const n = data.notifications;

  async function saveGeneral() {
    const next = await api.patch<SettingsDto["general"]>("/settings/general", g);
    setData((d) => (d ? { ...d, general: next } : d));
  }

  async function saveBackups() {
    const next = await api.patch<SettingsDto["backups"]>("/settings/backups", data!.backups);
    setData((d) => (d ? { ...d, backups: next } : d));
  }

  async function saveSecurity() {
    const next = await api.patch<SettingsDto["security"]>("/settings/security", data!.security);
    setData((d) => (d ? { ...d, security: next } : d));
  }

  async function saveLdap() {
    const payload = { ...l, ...(bindPassword ? { bindPassword } : {}) } as Record<string, unknown>;
    delete payload.hasBindPassword;
    const next = await api.patch<SettingsDto["ldap"]>("/settings/ldap", payload);
    setBindPassword("");
    setData((d) => (d ? { ...d, ldap: next } : d));
  }

  async function testLdap() {
    setLdapTesting(true);
    setLdapTest(null);
    try {
      setLdapTest(await api.post<LdapTestResultDto>("/settings/ldap/test", { username: ldapTestUser.trim(), password: ldapTestPass }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLdapTestPass("");
      setLdapTesting(false);
    }
  }

  async function saveNotifications() {
    const recipients = recipientsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      notifyOnStart: n.notifyOnStart,
      notifyOnSuccess: n.notifyOnSuccess,
      notifyOnFailure: n.notifyOnFailure,
      email: {
        enabled: n.email.enabled,
        provider: n.email.provider,
        from: n.email.from,
        recipients,
        smtp: {
          host: n.email.smtp.host,
          port: n.email.smtp.port,
          secure: n.email.smtp.secure,
          user: n.email.smtp.user,
          ...(smtpPassword ? { password: smtpPassword } : {}),
        },
        api: {
          url: n.email.api.url,
          authHeader: n.email.api.authHeader,
          ...(apiAuth ? { auth: apiAuth } : {}),
        },
      },
      telegram: {
        enabled: n.telegram.enabled,
        chatId: n.telegram.chatId,
        ...(botToken ? { botToken } : {}),
      },
    };
    const next = await api.patch<SettingsDto["notifications"]>("/settings/notifications", payload);
    setSmtpPassword("");
    setApiAuth("");
    setBotToken("");
    setRecipientsText(next.email.recipients.join(", "));
    setData((d) => (d ? { ...d, notifications: next } : d));
  }

  async function testNotifications() {
    setTesting(true);
    try {
      const res = await api.post<NotifTestResult>("/settings/notifications/test");
      const channels: [string, ChannelTest][] = [
        ["Email", res.email],
        ["Telegram", res.telegram],
      ];
      let any = false;
      for (const [channel, r] of channels) {
        if (r.ok === null) continue;
        any = true;
        if (r.ok) toast.success(t("settings.testOk", { channel }));
        else toast.error(t("settings.testFail", { channel, error: r.error ?? "" }));
      }
      if (!any) toast.info(t("settings.testNoChannel"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="settings-layout">
      <nav className="settings-nav">
        <button className={activeSection === "general" ? "active" : ""} onClick={() => setActiveSection("general")}>
          {t("settings.navGeneral")}
        </button>
        <button className={activeSection === "storage" ? "active" : ""} onClick={() => setActiveSection("storage")}>
          {t("settings.navStorage")}
        </button>
        <button className={activeSection === "backups" ? "active" : ""} onClick={() => setActiveSection("backups")}>
          {t("settings.navBackups")}
        </button>
        <button className={activeSection === "ldap" ? "active" : ""} onClick={() => setActiveSection("ldap")}>
          {t("settings.navLdap")}
        </button>
        <button className={activeSection === "security" ? "active" : ""} onClick={() => setActiveSection("security")}>
          {t("settings.navSecurity")}
        </button>
        <button
          className={activeSection === "notifications" ? "active" : ""}
          onClick={() => setActiveSection("notifications")}
        >
          {t("settings.navNotifications")}
        </button>
      </nav>

      <div className="settings-content">
        <div className="card form-card" hidden={activeSection !== "general"}>
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

      <div className="card form-card" hidden={activeSection !== "storage"}>
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
              .filter((s) => s.type === "local" && (s.isActive || s.isDefault))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {optionLabel(t, s.name, s.isActive)}
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
              .filter((s) => s.type === "bucket" && (s.isActive || s.isDefault))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {optionLabel(t, s.name, s.isActive)}
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
              .filter((a) => a.provider === "gcp" && (a.isActive || a.isDefault))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {optionLabel(t, a.name, a.isActive)}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="card form-card" hidden={activeSection !== "ldap"}>
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
          {t("settings.ldapMode")}
          <select
            value={l.mode}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, mode: e.target.value as LdapMode } })}
          >
            {LDAP_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`settings.ldapMode_${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("settings.ldapSecurity")}
          <select
            value={l.security}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, security: e.target.value as LdapSecurity } })}
          >
            {LDAP_SECURITY.map((m) => (
              <option key={m} value={m}>
                {t(`settings.ldapSecurity_${m}`)}
              </option>
            ))}
          </select>
        </label>
        {l.security === "none" && <p className="error full">{t("settings.ldapSecurityNoneWarn")}</p>}
        <label className="full">
          {t("settings.ldapUrl")}
          <input
            value={l.url}
            disabled={!canWrite}
            placeholder={l.security === "ldaps" ? "ldaps://126.26.3.151:636" : "ldap://126.26.3.151"}
            onChange={(e) => setData({ ...data, ldap: { ...l, url: e.target.value } })}
          />
        </label>
        {l.mode === "direct" ? (
          <>
            <label>
              {t("settings.ldapDomain")}
              <input
                value={l.domain}
                disabled={!canWrite}
                placeholder="DINTERSEGURO"
                onChange={(e) => setData({ ...data, ldap: { ...l, domain: e.target.value } })}
              />
              <small>{t("settings.ldapDomainHint")}</small>
            </label>
            <label>
              {t("settings.ldapSearchBase")}
              <input
                value={l.searchBase}
                disabled={!canWrite}
                placeholder="DC=empresa,DC=com"
                onChange={(e) => setData({ ...data, ldap: { ...l, searchBase: e.target.value } })}
              />
              <small>{t("settings.ldapSearchBaseOptional")}</small>
            </label>
          </>
        ) : (
          <>
            <label className="full">
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
            <label className="full">
              {t("settings.ldapSearchBase")}
              <input
                value={l.searchBase}
                disabled={!canWrite}
                onChange={(e) => setData({ ...data, ldap: { ...l, searchBase: e.target.value } })}
              />
            </label>
          </>
        )}
        <label className="full">
          {t("settings.ldapUserFilter")}
          <input
            value={l.userFilter}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, ldap: { ...l, userFilter: e.target.value } })}
          />
        </label>
        {l.security !== "none" && (
          <label className="inline">
            <input
              type="checkbox"
              checked={l.tlsRejectUnauthorized}
              disabled={!canWrite}
              onChange={(e) => setData({ ...data, ldap: { ...l, tlsRejectUnauthorized: e.target.checked } })}
            />
            {t("settings.ldapTls")}
          </label>
        )}
        {canWrite && (
          <div className="form-actions">
            <button onClick={() => notify(saveLdap)}>{t("common.save")}</button>
          </div>
        )}
        {canWrite && (
          <fieldset className="full">
            <legend>{t("settings.ldapTest")}</legend>
            <small className="muted">{t("settings.ldapTestHint")}</small>
            <label>
              {t("settings.ldapTestUser")}
              <input value={ldapTestUser} autoComplete="off" onChange={(e) => setLdapTestUser(e.target.value)} />
            </label>
            <label>
              {t("settings.ldapTestPassword")}
              <input
                type="password"
                value={ldapTestPass}
                autoComplete="new-password"
                onChange={(e) => setLdapTestPass(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                className="secondary"
                onClick={testLdap}
                disabled={ldapTesting || !ldapTestUser.trim() || !ldapTestPass}
              >
                {ldapTesting ? t("settings.ldapTesting") : t("settings.ldapTestBtn")}
              </button>
            </div>
            {ldapTest && (
              <p className={ldapTest.ok ? "success" : "error"}>
                {ldapTest.message}
                {ldapTest.ok && (ldapTest.fullName || ldapTest.email)
                  ? ` — ${[ldapTest.fullName, ldapTest.email].filter(Boolean).join(" · ")}`
                  : ""}
              </p>
            )}
          </fieldset>
        )}
      </div>

      <div className="card form-card" hidden={activeSection !== "backups"}>
        <h2>{t("settings.backups")}</h2>
        <label>
          {t("settings.cloudSqlHeartbeatMinutes")}
          <input
            type="number"
            min={0}
            max={1440}
            value={data.backups.cloudSqlHeartbeatMinutes}
            disabled={!canWrite}
            onChange={(e) =>
              setData({
                ...data,
                backups: { cloudSqlHeartbeatMinutes: Math.min(1440, Math.max(0, Math.trunc(Number(e.target.value) || 0))) },
              })
            }
          />
          <small>{t("settings.cloudSqlHeartbeatMinutesHint")}</small>
        </label>
        {canWrite && (
          <div className="form-actions">
            <button onClick={() => notify(saveBackups)}>{t("common.save")}</button>
          </div>
        )}
      </div>

      <div className="card form-card" hidden={activeSection !== "security"}>
        <h2>{t("settings.security")}</h2>
        <p className="muted full">{t("settings.securityHint")}</p>
        <label className="inline full">
          <input
            type="checkbox"
            checked={sec.loginLimitEnabled}
            disabled={!canWrite}
            onChange={(e) => setData({ ...data, security: { ...sec, loginLimitEnabled: e.target.checked } })}
          />
          {t("settings.loginLimitEnabled")}
        </label>
        <label>
          {t("settings.maxAttemptsPerUser")}
          <input
            type="number"
            min={1}
            value={sec.maxAttemptsPerUser}
            disabled={!canWrite || !sec.loginLimitEnabled}
            onChange={(e) => setData({ ...data, security: { ...sec, maxAttemptsPerUser: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } })}
          />
          <small>{t("settings.maxAttemptsPerUserHint")}</small>
        </label>
        <label>
          {t("settings.maxAttemptsPerIp")}
          <input
            type="number"
            min={1}
            value={sec.maxAttemptsPerIp}
            disabled={!canWrite || !sec.loginLimitEnabled}
            onChange={(e) => setData({ ...data, security: { ...sec, maxAttemptsPerIp: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } })}
          />
          <small>{t("settings.maxAttemptsPerIpHint")}</small>
        </label>
        <label>
          {t("settings.windowMinutes")}
          <input
            type="number"
            min={1}
            value={sec.windowMinutes}
            disabled={!canWrite || !sec.loginLimitEnabled}
            onChange={(e) => setData({ ...data, security: { ...sec, windowMinutes: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } })}
          />
        </label>
        <label>
          {t("settings.lockMinutes")}
          <input
            type="number"
            min={1}
            value={sec.lockMinutes}
            disabled={!canWrite || !sec.loginLimitEnabled}
            onChange={(e) => setData({ ...data, security: { ...sec, lockMinutes: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } })}
          />
        </label>
        {canWrite && (
          <div className="form-actions">
            <button onClick={() => notify(saveSecurity)}>{t("common.save")}</button>
          </div>
        )}
      </div>

      <div className="card form-card" hidden={activeSection !== "notifications"}>
        <h2>{t("settings.notifications")}</h2>

        <fieldset>
          <legend>{t("settings.notifEvents")}</legend>
          <label className="inline">
            <input
              type="checkbox"
              checked={n.notifyOnStart}
              disabled={!canWrite}
              onChange={(e) => setData({ ...data, notifications: { ...n, notifyOnStart: e.target.checked } })}
            />
            {t("settings.notifyOnStart")}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={n.notifyOnSuccess}
              disabled={!canWrite}
              onChange={(e) => setData({ ...data, notifications: { ...n, notifyOnSuccess: e.target.checked } })}
            />
            {t("settings.notifyOnSuccess")}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={n.notifyOnFailure}
              disabled={!canWrite}
              onChange={(e) => setData({ ...data, notifications: { ...n, notifyOnFailure: e.target.checked } })}
            />
            {t("settings.notifyOnFailure")}
          </label>
        </fieldset>

        <fieldset style={{ marginTop: "0.75rem" }}>
          <legend>{t("settings.notifEmail")}</legend>
          <label className="inline">
            <input
              type="checkbox"
              checked={n.email.enabled}
              disabled={!canWrite}
              onChange={(e) =>
                setData({ ...data, notifications: { ...n, email: { ...n.email, enabled: e.target.checked } } })
              }
            />
            {t("settings.emailEnabled")}
          </label>
          <label>
            {t("settings.emailProvider")}
            <select
              value={n.email.provider}
              disabled={!canWrite}
              onChange={(e) =>
                setData({
                  ...data,
                  notifications: { ...n, email: { ...n.email, provider: e.target.value as EmailProvider } },
                })
              }
            >
              {EMAIL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            {t("settings.emailFrom")}
            <input
              value={n.email.from}
              disabled={!canWrite}
              placeholder="DBKeeper <no-reply@empresa.com>"
              onChange={(e) =>
                setData({ ...data, notifications: { ...n, email: { ...n.email, from: e.target.value } } })
              }
            />
          </label>
          <label className="full">
            {t("settings.emailRecipients")}
            <input
              value={recipientsText}
              disabled={!canWrite}
              placeholder="ops@empresa.com, dba@empresa.com"
              onChange={(e) => setRecipientsText(e.target.value)}
            />
            <small>{t("settings.emailRecipientsHint")}</small>
          </label>

          {n.email.provider === "smtp" ? (
            <>
              <label className="full">
                {t("settings.smtpHost")}
                <input
                  value={n.email.smtp.host}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setData({
                      ...data,
                      notifications: { ...n, email: { ...n.email, smtp: { ...n.email.smtp, host: e.target.value } } },
                    })
                  }
                />
              </label>
              <label>
                {t("settings.smtpPort")}
                <input
                  type="number"
                  value={n.email.smtp.port}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setData({
                      ...data,
                      notifications: {
                        ...n,
                        email: { ...n.email, smtp: { ...n.email.smtp, port: Number(e.target.value) } },
                      },
                    })
                  }
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={n.email.smtp.secure}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setData({
                      ...data,
                      notifications: {
                        ...n,
                        email: { ...n.email, smtp: { ...n.email.smtp, secure: e.target.checked } },
                      },
                    })
                  }
                />
                {t("settings.smtpSecure")}
              </label>
              <label>
                {t("settings.smtpUser")}
                <input
                  value={n.email.smtp.user}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setData({
                      ...data,
                      notifications: { ...n, email: { ...n.email, smtp: { ...n.email.smtp, user: e.target.value } } },
                    })
                  }
                />
              </label>
              <label>
                {t("settings.smtpPassword")}
                <input
                  type="password"
                  value={smtpPassword}
                  disabled={!canWrite}
                  placeholder={n.email.smtp.hasPassword ? "••••••••" : ""}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                />
                <small>{t("settings.secretKeepHint")}</small>
              </label>
            </>
          ) : (
            <>
              <label className="full">
                {t("settings.apiUrl")}
                <input
                  value={n.email.api.url}
                  disabled={!canWrite}
                  placeholder="https://api.proveedor.com/send"
                  onChange={(e) =>
                    setData({
                      ...data,
                      notifications: { ...n, email: { ...n.email, api: { ...n.email.api, url: e.target.value } } },
                    })
                  }
                />
              </label>
              <label>
                {t("settings.apiAuthHeader")}
                <input
                  value={n.email.api.authHeader}
                  disabled={!canWrite}
                  placeholder="Authorization"
                  onChange={(e) =>
                    setData({
                      ...data,
                      notifications: {
                        ...n,
                        email: { ...n.email, api: { ...n.email.api, authHeader: e.target.value } },
                      },
                    })
                  }
                />
              </label>
              <label>
                {t("settings.apiAuth")}
                <input
                  type="password"
                  value={apiAuth}
                  disabled={!canWrite}
                  placeholder={n.email.api.hasAuth ? "••••••••" : "Bearer …"}
                  onChange={(e) => setApiAuth(e.target.value)}
                />
                <small>{t("settings.secretKeepHint")}</small>
              </label>
            </>
          )}
        </fieldset>

        <fieldset style={{ marginTop: "0.75rem" }}>
          <legend>{t("settings.notifTelegram")}</legend>
          <label className="inline">
            <input
              type="checkbox"
              checked={n.telegram.enabled}
              disabled={!canWrite}
              onChange={(e) =>
                setData({ ...data, notifications: { ...n, telegram: { ...n.telegram, enabled: e.target.checked } } })
              }
            />
            {t("settings.telegramEnabled")}
          </label>
          <label>
            {t("settings.telegramChatId")}
            <input
              value={n.telegram.chatId}
              disabled={!canWrite}
              onChange={(e) =>
                setData({ ...data, notifications: { ...n, telegram: { ...n.telegram, chatId: e.target.value } } })
              }
            />
          </label>
          <label>
            {t("settings.telegramBotToken")}
            <input
              type="password"
              value={botToken}
              disabled={!canWrite}
              placeholder={n.telegram.hasBotToken ? "••••••••" : ""}
              onChange={(e) => setBotToken(e.target.value)}
            />
            <small>{t("settings.secretKeepHint")}</small>
          </label>
        </fieldset>

        {canWrite && (
          <div className="form-actions">
            <button onClick={() => notify(saveNotifications)}>{t("common.save")}</button>
            <button className="secondary" disabled={testing} onClick={testNotifications}>
              {testing ? t("settings.testSending") : t("settings.testSend")}
            </button>
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
