import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Health = { status: string; db?: string } | null;

export function DashboardPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<Health>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ready")
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) setHealth(res.data);
        else setError(res.error?.message ?? "Error");
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <section>
      <h1>{t("nav.dashboard")}</h1>
      <p>
        API:{" "}
        {error ? (
          <code style={{ color: "crimson" }}>{error}</code>
        ) : health ? (
          <code>
            {health.status} (db: {health.db})
          </code>
        ) : (
          t("common.loading")
        )}
      </p>
    </section>
  );
}
