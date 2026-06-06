import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Database, History, Play, HardDrive } from "lucide-react";
import type { DashboardDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardDto>("/dashboard")
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, []);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : "—");

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  const rate =
    data.executions7d.total > 0
      ? Math.round((data.executions7d.success / data.executions7d.total) * 100)
      : null;

  const kpis = [
    { icon: Database, label: t("dashboard.kpiServers"), value: String(data.servers) },
    { icon: Play, label: t("dashboard.kpiJobs"), value: `${data.jobsActive}/${data.jobsTotal}` },
    { icon: History, label: t("dashboard.kpiExecutions7d"), value: String(data.executions7d.total) },
    { icon: History, label: t("dashboard.kpiSuccess7d"), value: rate == null ? "—" : `${rate}%` },
    { icon: HardDrive, label: t("dashboard.kpiSize7d"), value: fmtBytes(data.executions7d.bytes) },
  ];

  return (
    <section className="dashboard">
      <div className="kpi-grid">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div className="kpi-card" key={k.label}>
              <Icon className="kpi-icon" size={20} aria-hidden />
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-label">{k.label}</div>
            </div>
          );
        })}
      </div>

      <div className="dash-cols">
        <div className="card">
          <div className="card-head">
            <h2>{t("dashboard.recent")}</h2>
            <Link to="/executions" className="muted">
              {t("dashboard.seeAll")}
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="muted">{t("dashboard.recentEmpty")}</p>
          ) : (
            <table className="grid">
              <tbody>
                {data.recent.map((e) => (
                  <tr key={e.id}>
                    <td>{e.label}</td>
                    <td>
                      <span className={`badge badge-${e.status}`}>{t(`status.${e.status}`)}</span>
                    </td>
                    <td className="muted">{fmt(e.finishedAt)}</td>
                    <td>{fmtBytes(e.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>{t("dashboard.upcoming")}</h2>
          </div>
          {data.upcoming.length === 0 ? (
            <p className="muted">{t("dashboard.upcomingEmpty")}</p>
          ) : (
            <table className="grid">
              <tbody>
                {data.upcoming.map((u) => (
                  <tr key={u.jobId}>
                    <td>{u.jobName}</td>
                    <td className="muted">{t(`schedule.mode_${u.mode}`)}</td>
                    <td>{fmt(u.nextRunAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="muted dash-system">
        {t("dashboard.system")}: <span className="badge badge-success">{t("dashboard.apiOk")}</span>{" "}
        <span className="badge badge-success">{t("dashboard.dbUp")}</span>
      </p>
    </section>
  );
}
