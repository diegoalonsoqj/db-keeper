import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BACKUP_METHODS,
  type BackupJobDto,
  type BackupMethod,
  type BucketDto,
  type CredentialDto,
  type Paginated,
  type ServerDto,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { Modal } from "./Modal";

interface Props {
  job: BackupJobDto | null; // null = nuevo
  onClose: () => void;
  onSaved: () => void;
}

const uniq = (xs: string[]) => [...new Set(xs)];

export function BackupJobModal({ job, onClose, onSaved }: Props) {
  const { t } = useTranslation();

  const [servers, setServers] = useState<ServerDto[]>([]);
  const [credentials, setCredentials] = useState<CredentialDto[]>([]);
  const [buckets, setBuckets] = useState<BucketDto[]>([]);

  const [name, setName] = useState(job?.name ?? "");
  const [serverId, setServerId] = useState(job?.serverId ?? "");
  const [credentialId, setCredentialId] = useState(job?.credentialId ?? "");
  const [method, setMethod] = useState<BackupMethod>(job?.method ?? "dump");
  const [bucketId, setBucketId] = useState(job?.bucketId ?? "");
  const [isActive, setIsActive] = useState(job?.isActive ?? true);

  const [dbOptions, setDbOptions] = useState<string[]>(job?.databases ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set(job?.databases ?? []));
  const [discovering, setDiscovering] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Paginated<ServerDto>>("/servers?limit=100"),
      api.get<Paginated<CredentialDto>>("/credentials?limit=100"),
      api.get<Paginated<BucketDto>>("/buckets?limit=100"),
    ])
      .then(([s, c, b]) => {
        setServers(s.items);
        setCredentials(c.items);
        setBuckets(b.items);
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, []);

  async function discover() {
    if (!serverId) {
      setError(t("backups.pickServerFirst"));
      return;
    }
    setError(null);
    setDiscovering(true);
    try {
      const found = await api.post<string[]>(`/servers/${serverId}/databases/discover`);
      setDbOptions((prev) => uniq([...found, ...prev]));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  }

  function toggle(db: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      return next;
    });
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError(t("backups.nameRequired"));
    if (!serverId) return setError(t("backups.serverRequired"));
    if (selected.size === 0) return setError(t("backups.dbRequired"));
    if (method === "gcloud" && !bucketId) return setError(t("backups.bucketRequired"));

    const payload = {
      name: name.trim(),
      serverId,
      credentialId: credentialId || null,
      method,
      bucketId: bucketId || null,
      isActive,
      databases: [...selected],
    };
    try {
      if (job) await api.patch(`/backups/${job.id}`, payload);
      else await api.post("/backups", payload);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <Modal
      title={job ? t("common.edit") : t("backups.new")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button onClick={save}>{t("common.save")}</button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}

      <label>
        {t("backups.name")}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        {t("backups.server")}
        <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
          <option value="">{t("backups.pickServer")}</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.engine})
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("backups.credential")}
        <select value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
          <option value="">{t("backups.credentialInherit")}</option>
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.username})
            </option>
          ))}
        </select>
        <small>{t("backups.credentialHint")}</small>
      </label>
      <label>
        {t("backups.method")}
        <select value={method} onChange={(e) => setMethod(e.target.value as BackupMethod)}>
          {BACKUP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("backups.bucket")}
        <select value={bucketId} onChange={(e) => setBucketId(e.target.value)}>
          <option value="">{t("backups.bucketNone")}</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>{t("backups.databases")}</legend>
        <div className="db-toolbar">
          <button type="button" className="secondary" onClick={discover} disabled={discovering}>
            {discovering ? t("databases.discovering") : t("databases.discover")}
          </button>
          <span className="muted">{t("databases.selectedCount", { count: selected.size })}</span>
        </div>
        {dbOptions.length === 0 ? (
          <p className="muted">{t("backups.noDatabases")}</p>
        ) : (
          <ul className="db-list">
            {dbOptions.map((db) => (
              <li key={db}>
                <label className="inline">
                  <input type="checkbox" checked={selected.has(db)} onChange={() => toggle(db)} />
                  {db}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <label className="inline">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {t("backups.active")}
      </label>
    </Modal>
  );
}
