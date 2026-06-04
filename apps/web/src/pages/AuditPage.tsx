import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AuditEntryDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";

interface AuditList {
  items: AuditEntryDto[];
  total: number;
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AuditList>({ items: [], total: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AuditList>("/audit?limit=100")
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <section>
      <div className="page-head">
        <h1>{t("audit.title")}</h1>
        <span className="muted">{data.total}</span>
      </div>
      {error && <p className="error">{error}</p>}
      <table className="grid">
        <thead>
          <tr>
            <th>{t("audit.when")}</th>
            <th>{t("audit.user")}</th>
            <th>{t("audit.action")}</th>
            <th>{t("audit.entity")}</th>
            <th>{t("audit.ip")}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                {t("audit.empty")}
              </td>
            </tr>
          )}
          {data.items.map((e) => (
            <tr key={e.id}>
              <td>{fmt(e.createdAt)}</td>
              <td>{e.username ?? "—"}</td>
              <td>
                <code>{e.action}</code>
              </td>
              <td>{e.entityType ? `${e.entityType}${e.entityId ? `:${e.entityId.slice(0, 8)}` : ""}` : "—"}</td>
              <td>{e.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
