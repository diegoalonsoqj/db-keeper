import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DatabaseDto, DiscoveredDatabaseDto, ServerDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "./Modal";

interface Props {
  server: ServerDto;
  onClose: () => void;
}

/** Descubrimiento y selección de las bases de datos a respaldar de una instancia. */
export function DatabasesModal({ server, onClose }: Props) {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");

  const [rows, setRows] = useState<DiscoveredDatabaseDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DatabaseDto[]>(`/servers/${server.id}/databases`)
      .then((saved) => {
        setRows(saved.map((d) => ({ name: d.name, selected: true })));
        setSelected(new Set(saved.map((d) => d.name)));
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, [server.id]);

  async function discover() {
    setError(null);
    setMsg(null);
    setDiscovering(true);
    try {
      const found = await api.post<DiscoveredDatabaseDto[]>(`/servers/${server.id}/databases/discover`);
      setRows(found);
      setSelected(new Set(found.filter((d) => d.selected).map((d) => d.name)));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save() {
    setError(null);
    setMsg(null);
    try {
      await api.put(`/servers/${server.id}/databases`, { names: [...selected] });
      setMsg(t("databases.saved"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <Modal
      title={t("databases.title", { name: server.name })}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          {canWrite && (
            <button onClick={save} disabled={rows.length === 0}>
              {t("databases.save")}
            </button>
          )}
        </>
      }
    >
      <div className="db-toolbar">
        <button className="secondary" onClick={discover} disabled={discovering}>
          {discovering ? t("databases.discovering") : t("databases.discover")}
        </button>
        <span className="muted">{t("databases.selectedCount", { count: selected.size })}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="success">{msg}</p>}

      {rows.length === 0 ? (
        <p className="muted">{t("databases.empty")}</p>
      ) : (
        <ul className="db-list">
          {rows.map((d) => (
            <li key={d.name}>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={selected.has(d.name)}
                  disabled={!canWrite}
                  onChange={() => toggle(d.name)}
                />
                {d.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
