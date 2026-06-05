import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BACKUP_METHODS,
  ENGINE_BACKUP_OPTIONS,
  type BackupJobDto,
  type BackupMethod,
  type StorageTargetDto,
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
  const [buckets, setBuckets] = useState<StorageTargetDto[]>([]);

  const [name, setName] = useState(job?.name ?? "");
  const [serverId, setServerId] = useState(job?.serverId ?? "");
  const [credentialId, setCredentialId] = useState(job?.credentialId ?? "");
  const [method, setMethod] = useState<BackupMethod>(job?.method ?? "dump");
  const [bucketId, setBucketId] = useState(job?.bucketId ?? "");
  // Comprimir con gzip por defecto; solo se desactiva si options.compress === false.
  const [compress, setCompress] = useState(job?.options?.compress !== false);
  // Tablas a excluir, editadas como texto separado por comas/saltos de línea.
  const [excludeTables, setExcludeTables] = useState(
    (job?.options?.excludeTables as string[] | undefined)?.join(", ") ?? "",
  );
  const [isActive, setIsActive] = useState(job?.isActive ?? true);

  const [dbOptions, setDbOptions] = useState<string[]>(job?.databases ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set(job?.databases ?? []));
  const [discovering, setDiscovering] = useState(false);

  // Opciones de dump aplicables según el motor de la instancia elegida.
  const selectedServer = servers.find((s) => s.id === serverId);
  const engine = selectedServer?.engine;
  const dumpOpts = method === "dump" && engine ? ENGINE_BACKUP_OPTIONS[engine] : [];
  const showCompress = dumpOpts.includes("compress");
  const showExclude = dumpOpts.includes("excludeTables");

  // Ambiente consolidado del evento: el de la instancia y el de la credencial
  // efectiva (override, o la heredada de la instancia) deben coincidir.
  const effectiveCred = credentials.find(
    (c) => c.id === (credentialId || selectedServer?.credentialId),
  );
  const envServer = selectedServer?.environment?.trim() || null;
  const envCred = effectiveCred?.environment?.trim() || null;
  const envMismatch = !!(envServer && envCred && envServer.toLowerCase() !== envCred.toLowerCase());
  const derivedEnv = envServer ?? envCred ?? null;

  // Destino local por defecto (se usa cuando el evento no va a un bucket).
  const defaultLocal = buckets.find((b) => b.type === "local" && b.isDefault);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Paginated<ServerDto>>("/servers?limit=100"),
      api.get<Paginated<CredentialDto>>("/credentials?limit=100"),
      api.get<Paginated<StorageTargetDto>>("/storage?limit=100"),
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
    if (envMismatch) return setError(t("backups.environmentMismatch", { server: envServer, cred: envCred }));

    // Conserva opciones existentes y fija/limpia solo las aplicables al motor.
    const options: Record<string, unknown> = { ...(job?.options ?? {}) };
    if (showCompress) options.compress = compress;
    else delete options.compress;
    if (showExclude)
      options.excludeTables = excludeTables
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);
    else delete options.excludeTables;

    const payload = {
      name: name.trim(),
      serverId,
      credentialId: credentialId || null,
      method,
      bucketId: bucketId || null,
      options,
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
        {t("backups.environment")}
        <input value={derivedEnv ?? ""} readOnly placeholder={t("backups.environmentNone")} />
        {envMismatch ? (
          <small className="error">
            {t("backups.environmentMismatch", { server: envServer, cred: envCred })}
          </small>
        ) : (
          <small>{t("backups.environmentHint")}</small>
        )}
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
      {method === "gcloud" ? (
        <label>
          {t("backups.destination")}
          <select value={bucketId} onChange={(e) => setBucketId(e.target.value)}>
            <option value="">{t("backups.bucketNone")}</option>
            {buckets
              .filter((b) => b.type === "gcs")
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <label>
          {t("backups.destination")}
          <input
            readOnly
            value={
              defaultLocal
                ? `${defaultLocal.name}${defaultLocal.path ? ` — ${defaultLocal.path}` : ""}`
                : t("storage.type_local")
            }
          />
          <small>{t("backups.destinationLocalHint")}</small>
        </label>
      )}

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

      {showExclude && (
        <label>
          {t("backups.excludeTables")}
          <input
            value={excludeTables}
            onChange={(e) => setExcludeTables(e.target.value)}
            placeholder={t("backups.excludeTablesPlaceholder")}
          />
          <small>{t("backups.excludeTablesHint")}</small>
        </label>
      )}

      {showCompress && (
        <>
          <label className="inline">
            <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
            {t("backups.compress")}
          </label>
          <small>{t("backups.compressHint")}</small>
        </>
      )}

      <label className="inline">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {t("backups.active")}
      </label>
    </Modal>
  );
}
