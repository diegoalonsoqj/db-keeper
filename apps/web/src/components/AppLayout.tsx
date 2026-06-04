import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <strong>{t("app.name")}</strong>
          <span className="tagline"> — {t("app.tagline")}</span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
