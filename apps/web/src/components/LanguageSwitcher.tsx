import { useTranslation } from "react-i18next";
import { APP_LOCALES } from "@dbkeeper/shared";

const LABELS: Record<string, string> = {
  "es-419": "Español (LatAm)",
  en: "English",
};

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  return (
    <label className="lang-switcher">
      <span>{t("common.language")}: </span>
      <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
        {APP_LOCALES.map((loc) => (
          <option key={loc} value={loc}>
            {LABELS[loc] ?? loc}
          </option>
        ))}
      </select>
    </label>
  );
}
