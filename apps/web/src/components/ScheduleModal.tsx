import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ScheduleDto, type ScheduleMode, type SettingsDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { Modal } from "./Modal";

interface Props {
  jobId: string;
  jobName: string;
  onClose: () => void;
  onSaved?: () => void;
}

type Frequency = "daily" | "weekly" | "monthly" | "advanced";

/** Construye un cron a partir del builder de presets. */
function buildCron(freq: Frequency, time: string, weekday: number, dom: number, advanced: string): string {
  const [h, m] = time.split(":");
  const hour = Number(h ?? 0);
  const min = Number(m ?? 0);
  switch (freq) {
    case "daily":
      return `${min} ${hour} * * *`;
    case "weekly":
      return `${min} ${hour} * * ${weekday}`;
    case "monthly":
      return `${min} ${hour} ${dom} * *`;
    default:
      return advanced.trim();
  }
}

/** Intenta reconstruir el builder desde un cron simple; si no, 'advanced'. */
function parseCron(cron: string): { freq: Frequency; time: string; weekday: number; dom: number } {
  const pad = (n: number) => String(n).padStart(2, "0");
  let mm;
  if ((mm = /^(\d+) (\d+) \* \* \*$/.exec(cron)))
    return { freq: "daily", time: `${pad(+mm[2]!)}:${pad(+mm[1]!)}`, weekday: 1, dom: 1 };
  if ((mm = /^(\d+) (\d+) \* \* (\d+)$/.exec(cron)))
    return { freq: "weekly", time: `${pad(+mm[2]!)}:${pad(+mm[1]!)}`, weekday: +mm[3]!, dom: 1 };
  if ((mm = /^(\d+) (\d+) (\d+) \* \*$/.exec(cron)))
    return { freq: "monthly", time: `${pad(+mm[2]!)}:${pad(+mm[1]!)}`, weekday: 1, dom: +mm[3]! };
  return { freq: "advanced", time: "21:00", weekday: 1, dom: 1 };
}

export function ScheduleModal({ jobId, jobName, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation();

  const [mode, setMode] = useState<ScheduleMode | "none">("none");
  const [runAt, setRunAt] = useState("");
  const [freq, setFreq] = useState<Frequency>("daily");
  const [time, setTime] = useState("21:00");
  const [weekday, setWeekday] = useState(1);
  const [dom, setDom] = useState(1);
  const [advanced, setAdvanced] = useState("");
  const [timezone, setTimezone] = useState("");
  const [current, setCurrent] = useState<ScheduleDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ScheduleDto | null>(`/backups/${jobId}/schedule`),
      api.get<SettingsDto>("/settings"),
    ])
      .then(([sched, settings]) => {
        setTimezone(settings.general.timezone);
        if (!sched) return;
        setCurrent(sched);
        setMode(sched.mode);
        setTimezone(sched.timezone);
        if (sched.mode === "once" && sched.runAt) {
          // Mostrar la hora de pared en la zona de la programación.
          setRunAt(wallClockInZone(sched.runAt, sched.timezone));
        } else if (sched.mode === "recurring" && sched.cron) {
          const p = parseCron(sched.cron);
          setFreq(p.freq);
          setTime(p.time);
          setWeekday(p.weekday);
          setDom(p.dom);
          setAdvanced(sched.cron);
        }
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, [jobId]);

  const cronPreview = mode === "recurring" ? buildCron(freq, time, weekday, dom, advanced) : "";

  // Nombres de día localizados (0=domingo).
  const weekdayNames = Array.from({ length: 7 }, (_, d) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(new Date(Date.UTC(2024, 0, 7 + d))),
  );

  async function save() {
    setError(null);
    setMsg(null);
    try {
      if (mode === "none") {
        await api.delete(`/backups/${jobId}/schedule`);
      } else if (mode === "once") {
        if (!runAt) return setError(t("schedule.runAtRequired"));
        await api.put(`/backups/${jobId}/schedule`, { mode: "once", runAt, timezone });
      } else {
        const cron = cronPreview;
        if (!cron) return setError(t("schedule.cronRequired"));
        await api.put(`/backups/${jobId}/schedule`, { mode: "recurring", cron, timezone });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <Modal
      title={`${t("schedule.title")} — ${jobName}`}
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
      {msg && <p className="success">{msg}</p>}
      {current?.nextRunAt && (
        <p className="muted">
          {t("schedule.nextRun")}: {new Date(current.nextRunAt).toLocaleString(i18n.language)}
        </p>
      )}

      <label>
        {t("schedule.mode")}
        <select value={mode} onChange={(e) => setMode(e.target.value as ScheduleMode | "none")}>
          <option value="none">{t("schedule.mode_none")}</option>
          <option value="once">{t("schedule.mode_once")}</option>
          <option value="recurring">{t("schedule.mode_recurring")}</option>
        </select>
      </label>

      {mode === "once" && (
        <label>
          {t("schedule.runAt")}
          <input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          <small>{t("schedule.tzNote", { tz: timezone })}</small>
        </label>
      )}

      {mode === "recurring" && (
        <>
          <label>
            {t("schedule.frequency")}
            <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
              <option value="daily">{t("schedule.freq_daily")}</option>
              <option value="weekly">{t("schedule.freq_weekly")}</option>
              <option value="monthly">{t("schedule.freq_monthly")}</option>
              <option value="advanced">{t("schedule.freq_advanced")}</option>
            </select>
          </label>

          {freq !== "advanced" && (
            <label>
              {t("schedule.time")}
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
          {freq === "weekly" && (
            <label>
              {t("schedule.weekday")}
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {weekdayNames.map((name, d) => (
                  <option key={d} value={d}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {freq === "monthly" && (
            <label>
              {t("schedule.dayOfMonth")}
              <input
                type="number"
                min={1}
                max={31}
                value={dom}
                onChange={(e) => setDom(Number(e.target.value))}
              />
            </label>
          )}
          {freq === "advanced" && (
            <label>
              {t("schedule.cron")}
              <input value={advanced} onChange={(e) => setAdvanced(e.target.value)} placeholder="0 21 * * *" />
              <small>{t("schedule.cronHint")}</small>
            </label>
          )}

          <p className="muted">
            cron: <code>{cronPreview || "—"}</code> · {t("schedule.tzNote", { tz: timezone })}
          </p>
        </>
      )}
    </Modal>
  );
}

/** Convierte un instante ISO a "YYYY-MM-DDTHH:mm" de pared en la zona dada. */
function wallClockInZone(iso: string, timezone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(iso))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
