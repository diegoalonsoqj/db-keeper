import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ALLOYDB_STDERR_IGNORE,
  BACKUP_METHODS,
  PARALLEL_DUMP_LIMITS,
  SCRATCH_DISK_TYPES,
  type ParallelEnvironmentDto,
  ENGINE_BACKUP_OPTIONS,
  collectionRuleError,
  formatBytes,
  parseCollectionRules,
  type BackupJobDto,
  type BackupMethod,
  type DiscoveredDatabase,
  type PgEventTrigger,
  type PgExtension,
  type StorageTargetDto,
  type CredentialDto,
  type Paginated,
  type ServerDto,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { Modal } from "./Modal";
import { ExcludeByDbSection, useDbExclusions } from "./ExcludeByDbSection";
import { MongoCollectionExclusions } from "./MongoCollectionExclusions";
import { METHOD_LABELS } from "../lib/backup-methods";
import { optionLabel } from "../lib/options";

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
  // MongoDB: reglas de colecciones a excluir (una por línea).
  const [excludeCollections, setExcludeCollections] = useState(
    (job?.options?.excludeCollections as string[] | undefined)?.join("\n") ?? "",
  );
  const [collectionsCaseSensitive, setCollectionsCaseSensitive] = useState(
    job?.options?.excludeCollectionsCaseSensitive === true,
  );
  // MySQL: quitar DEFINER por defecto.
  const [cleanDefiners, setCleanDefiners] = useState(job?.options?.cleanDefiners !== false);
  const [pgCompat, setPgCompat] = useState(job?.options?.pgCompat !== false);
  // Modo detallado: añade --verbose y muestra la consola en vivo.
  const [verbose, setVerbose] = useState(job?.options?.verbose === true);
  const [keepLocalCopy, setKeepLocalCopy] = useState(job?.options?.keepLocalCopy === true);
  // SQL Server: carpeta de backup en el host de la instancia.
  const [sqlBackupDir, setSqlBackupDir] = useState(
    (job?.options?.sqlBackupDir as string | undefined) ?? "",
  );
  // Retención: borrar backups con más de N días y/o conservar solo los últimos N.
  const ret = job?.options?.retention as { days?: number | null; keepLast?: number | null } | undefined;
  const [retDays, setRetDays] = useState(ret?.days != null ? String(ret.days) : "");
  const [retKeep, setRetKeep] = useState(ret?.keepLast != null ? String(ret.keepLast) : "");
  const [isActive, setIsActive] = useState(job?.isActive ?? true);

  // Dump paralelo (pg_parallel): opciones propias; vacío = valor automático/por defecto.
  const [parallelEnv, setParallelEnv] = useState<ParallelEnvironmentDto | null>(null);
  const opt = job?.options ?? {};
  const [parallelJobs, setParallelJobs] = useState(typeof opt.parallelJobs === "number" ? String(opt.parallelJobs) : "");
  const [noPrivileges, setNoPrivileges] = useState(opt.noPrivileges === true);
  const [diskSizeGb, setDiskSizeGb] = useState(typeof opt.diskSizeGb === "number" ? String(opt.diskSizeGb) : "");
  const [diskType, setDiskType] = useState(typeof opt.diskType === "string" ? opt.diskType : "");
  const [maxHours, setMaxHours] = useState(typeof opt.maxHours === "number" ? String(opt.maxHours) : "");
  const [stderrIgnore, setStderrIgnore] = useState(
    Array.isArray(opt.stderrIgnore) ? (opt.stderrIgnore as string[]).join("\n") : "",
  );

  // PostgreSQL: esquemas, extensiones y event triggers a excluir por BD ({ bd: [nombres] }).
  const exclusionCtx = { serverId, credentialId, onError: (m: string | null) => setError(m) };
  const schemas = useDbExclusions<string>({
    ...exclusionCtx,
    initial: job?.options?.excludeSchemas,
    path: "schemas",
    toItem: (s) => ({ name: s, label: s }),
  });
  const extensions = useDbExclusions<PgExtension>({
    ...exclusionCtx,
    initial: job?.options?.excludeExtensions,
    path: "extensions",
    toItem: (e) => ({ name: e.name, label: `${e.name} (${e.version})` }),
  });
  const eventTriggers = useDbExclusions<PgEventTrigger>({
    ...exclusionCtx,
    initial: job?.options?.excludeEventTriggers,
    path: "event-triggers",
    toItem: (e) => ({
      name: e.name,
      label: `${e.name} (${e.event}${e.enabled === "D" ? `, ${t("backups.eventTriggerDisabled")}` : ""})`,
    }),
  });
  const [dbOptions, setDbOptions] = useState<string[]>(job?.databases ?? []);
  // Tamaño de cada BD descubierta (null = el motor/permiso no lo informa).
  const [dbSizes, setDbSizes] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set(job?.databases ?? []));
  const [discovering, setDiscovering] = useState(false);

  // Opciones de dump aplicables según el motor de la instancia elegida. Aplican a
  // ambos métodos: "Subir a bucket" también ejecuta el dump, solo cambia el destino.
  const selectedServer = servers.find((s) => s.id === serverId);
  const engine = selectedServer?.engine;
  // Export de Cloud SQL: solo para SQL Server marcado como Cloud SQL. Lo genera la
  // instancia en el bucket, así que no aplican las opciones de dump.
  const exportAvailable = engine === "sqlserver" && !!selectedServer?.isCloudSql;
  const isExport = method === "cloudsql_export";
  // Dump paralelo: solo PostgreSQL y con el disco temporal habilitado en Configuración.
  const parallelAvailable = engine === "postgres" && (!!parallelEnv?.enabled || job?.method === "pg_parallel");
  const isParallel = method === "pg_parallel";
  const methods = BACKUP_METHODS.filter(
    (m) => (m !== "cloudsql_export" || exportAvailable) && (m !== "pg_parallel" || parallelAvailable),
  );
  const usesBucket = method === "gcloud" || isExport || isParallel;
  const dumpOpts = engine && !isExport ? ENGINE_BACKUP_OPTIONS[engine] : [];
  const showCompress = dumpOpts.includes("compress");
  const showExclude = dumpOpts.includes("excludeTables");
  const showExcludeSchemas = dumpOpts.includes("excludeSchemas");
  const showExcludeExtensions = dumpOpts.includes("excludeExtensions");
  const showExcludeEventTriggers = dumpOpts.includes("excludeEventTriggers");
  const showExcludeCollections = dumpOpts.includes("excludeCollections");
  const showCleanDefiners = dumpOpts.includes("cleanDefiners");
  // -Fd no genera SQL plano: la compatibilidad de versiones no aplica.
  const showPgCompat = dumpOpts.includes("pgCompat") && !isParallel;
  const showVerbose = dumpOpts.includes("verbose");
  const showKeepLocalCopy = method === "gcloud" && engine !== "sqlserver";
  const showSqlBackupDir = dumpOpts.includes("sqlBackupDir");

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

  // Si la instancia elegida no admite el export de Cloud SQL, volver al método local.
  useEffect(() => {
    if (isExport && selectedServer && !exportAvailable) setMethod("dump");
  }, [isExport, selectedServer, exportAvailable]);
  useEffect(() => {
    if (isParallel && selectedServer && engine !== "postgres") setMethod("dump");
  }, [isParallel, selectedServer, engine]);

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
    // Opcional: sin él solo no se ofrece el dump paralelo.
    api
      .get<ParallelEnvironmentDto>("/backups/parallel/environment")
      .then(setParallelEnv)
      .catch(() => setParallelEnv(null));
  }, []);

  async function discover() {
    if (!serverId) {
      setError(t("backups.pickServerFirst"));
      return;
    }
    setError(null);
    setDiscovering(true);
    try {
      // Descubrir con la credencial del evento (override) si se eligió; si no, el
      // backend usa la de la instancia. Permite descubrir instancias sin credencial base.
      // En el export de Cloud SQL se listan con la API de Cloud SQL (sin conectarse a la BD).
      const found = await api.post<DiscoveredDatabase[]>(`/servers/${serverId}/databases/discover`, {
        credentialId: credentialId || null,
        via: isExport ? "cloudsql" : "direct",
      });
      setDbOptions((prev) => uniq([...found.map((d) => d.name), ...prev]));
      setDbSizes(Object.fromEntries(found.map((d) => [d.name, d.bytes])));
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
    if (usesBucket && !bucketId) return setError(t("backups.bucketRequired"));
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
    delete options.excludeCollections;
    delete options.excludeCollectionsCaseSensitive;
    if (showExcludeCollections) {
      const rules = parseCollectionRules(excludeCollections, collectionsCaseSensitive);
      const ruleError = rules.map((r) => collectionRuleError(r, [...selected])).find(Boolean);
      if (ruleError) return setError(ruleError);
      if (rules.length > 0) {
        options.excludeCollections = rules;
        if (collectionsCaseSensitive) options.excludeCollectionsCaseSensitive = true;
      }
    }
    // Solo de las BDs seleccionadas (el backend vuelve a validarlo).
    const exclusions = [
      ["excludeSchemas", showExcludeSchemas, schemas],
      ["excludeExtensions", showExcludeExtensions, extensions],
      ["excludeEventTriggers", showExcludeEventTriggers, eventTriggers],
    ] as const;
    for (const [key, show, ex] of exclusions) {
      const value = show ? ex.forSave(selected) : undefined;
      if (value) options[key] = value;
      else delete options[key];
    }
    if (showCleanDefiners) options.cleanDefiners = cleanDefiners;
    else delete options.cleanDefiners;
    if (showPgCompat) options.pgCompat = pgCompat;
    else delete options.pgCompat;
    delete options.mongoSrv; // pasó a la instancia (conexión SRV)
    if (showVerbose) options.verbose = verbose;
    else delete options.verbose;
    if (showKeepLocalCopy && keepLocalCopy) options.keepLocalCopy = true;
    else delete options.keepLocalCopy;
    if (showSqlBackupDir) options.sqlBackupDir = sqlBackupDir.trim();
    else delete options.sqlBackupDir;
    for (const k of ["parallelJobs", "noPrivileges", "diskSizeGb", "diskType", "maxHours", "stderrIgnore"]) delete options[k];
    if (isParallel) {
      // Vacío = automático: el backend aplica el valor por defecto.
      if (parallelJobs.trim()) options.parallelJobs = Number(parallelJobs);
      options.noPrivileges = noPrivileges;
      options.diskSizeGb = diskSizeGb.trim() ? Number(diskSizeGb) : null;
      options.diskType = diskType || null;
      if (maxHours.trim()) options.maxHours = Number(maxHours);
      options.stderrIgnore = stderrIgnore
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }

    // Retención: solo almacenamiento local (método dump); en buckets la app no borra.
    // Días y/o cantidad; vacío = sin regla.
    const days = !usesBucket && retDays.trim() ? Number(retDays) : null;
    const keepLast = !usesBucket && retKeep.trim() ? Number(retKeep) : null;
    if ((days != null && (!Number.isInteger(days) || days < 1)) ||
        (keepLast != null && (!Number.isInteger(keepLast) || keepLast < 1))) {
      return setError(t("backups.retentionInvalid"));
    }
    if (days != null || keepLast != null) options.retention = { days, keepLast };
    else delete options.retention;

    const payload = {
      name: name.trim(),
      serverId,
      credentialId: credentialId || null,
      method,
      bucketId: usesBucket ? bucketId || null : null,
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
        <select
          value={serverId}
          onChange={(e) => {
            setServerId(e.target.value);
            // Cloud SQL (SQL Server): el export es el método natural (no usa host ni credencial de BD).
            const s = servers.find((x) => x.id === e.target.value);
            if (s?.engine === "sqlserver" && s.isCloudSql) setMethod("cloudsql_export");
            // AlloyDB (evento nuevo): dump paralelo con el filtro de ruido y consola en vivo.
            if (!job && s?.isAlloyDb && parallelEnv?.enabled) {
              setMethod("pg_parallel");
              setVerbose(true);
              if (!stderrIgnore.trim()) setStderrIgnore(ALLOYDB_STDERR_IGNORE.join("\n"));
            }
          }}
        >
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
          {methods.map((m) => (
            <option key={m} value={m}>
              {t(METHOD_LABELS[m])}
            </option>
          ))}
        </select>
        {isExport && <small>{t("backups.methodCloudSqlExportHint")}</small>}
        {isParallel && <small>{t("backups.methodParallelHint")}</small>}
      </label>
      {usesBucket ? (
        <label>
          {t("backups.destination")}
          <select value={bucketId} onChange={(e) => setBucketId(e.target.value)}>
            <option value="">{t("backups.bucketNone")}</option>
            {buckets
              .filter((b) => b.type === "bucket" && (!(isExport || isParallel) || b.provider === "gcp"))
              .filter((b) => b.isActive || b.id === bucketId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {optionLabel(t, b.name, b.isActive)}
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

      {isParallel && (
        <fieldset>
          <legend>{t("backups.parallel")}</legend>
          {parallelEnv?.gce && (
            <small className="muted">
              {t("backups.parallelEnv", {
                vm: parallelEnv.gce.instance,
                zone: parallelEnv.gce.zone,
                machine: parallelEnv.gce.machineType ?? "?",
                vcpus: parallelEnv.vcpus,
                mount: parallelEnv.mountPoint,
              })}
            </small>
          )}
          <label>
            {t("backups.parallelJobs")}
            <input
              type="number"
              min={PARALLEL_DUMP_LIMITS.parallelJobs.min}
              max={PARALLEL_DUMP_LIMITS.parallelJobs.max}
              value={parallelJobs}
              onChange={(e) => setParallelJobs(e.target.value)}
              placeholder={parallelEnv ? String(parallelEnv.suggestedJobs) : ""}
            />
            <small>
              {t("backups.parallelJobsHint", {
                vcpus: parallelEnv?.vcpus ?? "?",
                suggested: parallelEnv?.suggestedJobs ?? "?",
                conns: (Number(parallelJobs) || parallelEnv?.suggestedJobs || 0) + 1,
              })}
            </small>
          </label>
          <label className="inline">
            <input type="checkbox" checked={noPrivileges} onChange={(e) => setNoPrivileges(e.target.checked)} />
            {t("backups.noPrivileges")}
          </label>
          <small>{t("backups.noPrivilegesHint")}</small>
          {noPrivileges && <p className="warning">{t("backups.noPrivilegesWarning")}</p>}
          <label>
            {t("backups.diskSizeGb")}
            <input
              type="number"
              min={10}
              max={parallelEnv?.maxSizeGb}
              value={diskSizeGb}
              onChange={(e) => setDiskSizeGb(e.target.value)}
              placeholder={t("backups.diskSizeAuto")}
            />
            <small>{t("backups.diskSizeHint", { def: parallelEnv?.defaultSizeGb ?? "?", max: parallelEnv?.maxSizeGb ?? "?" })}</small>
          </label>
          <label>
            {t("backups.diskType")}
            <select value={diskType} onChange={(e) => setDiskType(e.target.value)}>
              <option value="">{t("backups.diskTypeDefault", { type: parallelEnv?.diskType ?? "?" })}</option>
              {SCRATCH_DISK_TYPES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("backups.maxHours")}
            <input
              type="number"
              min={PARALLEL_DUMP_LIMITS.maxHours.min}
              max={parallelEnv?.dumpMaxHours}
              value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
              placeholder={String(Math.min(12, parallelEnv?.dumpMaxHours ?? 12))}
            />
            <small>{t("backups.maxHoursHint", { max: parallelEnv?.dumpMaxHours ?? "?" })}</small>
          </label>
          <label>
            {t("backups.stderrIgnore")}
            <textarea rows={3} value={stderrIgnore} onChange={(e) => setStderrIgnore(e.target.value)} />
            <small>
              {t("backups.stderrIgnoreHint", {
                lines: PARALLEL_DUMP_LIMITS.stderrIgnoreLines,
                len: PARALLEL_DUMP_LIMITS.stderrIgnoreLength,
              })}
            </small>
          </label>
        </fieldset>
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
                  {dbSizes[db] != null && <span className="muted">({formatBytes(dbSizes[db])})</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {showExcludeSchemas && selected.size > 0 && (
        <ExcludeByDbSection
          legend={t("backups.excludeSchemas")}
          hint={t("backups.excludeSchemasHint")}
          loadLabel={t("backups.loadSchemas")}
          loadingLabel={t("backups.loadingSchemas")}
          databases={[...selected]}
          loaded={schemas.loaded}
          excluded={schemas.excluded}
          loadingDb={schemas.loadingDb}
          onLoad={schemas.load}
          onToggle={schemas.toggle}
        />
      )}

      {showExcludeExtensions && selected.size > 0 && (
        <ExcludeByDbSection
          legend={t("backups.excludeExtensions")}
          warning={t("backups.excludeExtensionsHint")}
          loadLabel={t("backups.loadExtensions")}
          loadingLabel={t("backups.loadingExtensions")}
          databases={[...selected]}
          loaded={extensions.loaded}
          excluded={extensions.excluded}
          loadingDb={extensions.loadingDb}
          onLoad={extensions.load}
          onToggle={extensions.toggle}
        />
      )}

      {showExcludeEventTriggers && selected.size > 0 && (
        <ExcludeByDbSection
          legend={t("backups.excludeEventTriggers")}
          warning={isParallel ? t("backups.excludeEventTriggersParallelHint") : t("backups.excludeEventTriggersHint")}
          loadLabel={t("backups.loadEventTriggers")}
          loadingLabel={t("backups.loadingEventTriggers")}
          databases={[...selected]}
          loaded={eventTriggers.loaded}
          excluded={eventTriggers.excluded}
          loadingDb={eventTriggers.loadingDb}
          onLoad={eventTriggers.load}
          onToggle={eventTriggers.toggle}
        />
      )}

      {showExcludeCollections && (
        <MongoCollectionExclusions
          serverId={serverId}
          credentialId={credentialId}
          databases={[...selected]}
          rulesText={excludeCollections}
          caseSensitive={collectionsCaseSensitive}
          onCaseSensitiveChange={setCollectionsCaseSensitive}
          onRulesTextChange={setExcludeCollections}
          onError={setError}
        />
      )}

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

      {showSqlBackupDir && (
        <label>
          {t("backups.sqlBackupDir")}
          <input
            value={sqlBackupDir}
            onChange={(e) => setSqlBackupDir(e.target.value)}
            placeholder="D:\\Backups o /var/opt/mssql/backups"
          />
          <small>{t("backups.sqlBackupDirHint")}</small>
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

      {showCleanDefiners && (
        <>
          <label className="inline">
            <input
              type="checkbox"
              checked={cleanDefiners}
              onChange={(e) => setCleanDefiners(e.target.checked)}
            />
            {t("backups.cleanDefiners")}
          </label>
          <small>{t("backups.cleanDefinersHint")}</small>
        </>
      )}

      {showPgCompat && (
        <>
          <label className="inline">
            <input type="checkbox" checked={pgCompat} onChange={(e) => setPgCompat(e.target.checked)} />
            {t("backups.pgCompat")}
          </label>
          <small>{t("backups.pgCompatHint")}</small>
        </>
      )}


      {showVerbose && (
        <>
          <label className="inline">
            <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} />
            {t("backups.verbose")}
          </label>
          <small>{t("backups.verboseHint")}</small>
        </>
      )}

      {showKeepLocalCopy && (
        <>
          <label className="inline">
            <input type="checkbox" checked={keepLocalCopy} onChange={(e) => setKeepLocalCopy(e.target.checked)} />
            {t("backups.keepLocalCopy")}
          </label>
          <small>{t("backups.keepLocalCopyHint")}</small>
        </>
      )}

      {usesBucket ? (
        <small className="muted">{t("backups.retentionBucketNote")}</small>
      ) : (
        <fieldset>
          <legend>{t("backups.retention")}</legend>
          <small className="muted">{t("backups.retentionHint")}</small>
          <label>
            {t("backups.retentionDays")}
            <input
              type="number"
              min={1}
              value={retDays}
              onChange={(e) => setRetDays(e.target.value)}
              placeholder={t("backups.retentionNoLimit")}
            />
          </label>
          <label>
            {t("backups.retentionKeep")}
            <input
              type="number"
              min={1}
              value={retKeep}
              onChange={(e) => setRetKeep(e.target.value)}
              placeholder={t("backups.retentionNoLimit")}
            />
          </label>
          {engine === "sqlserver" && <small className="muted">{t("backups.retentionSqlNote")}</small>}
        </fieldset>
      )}

      <label className="inline">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {t("backups.active")}
      </label>
    </Modal>
  );
}
