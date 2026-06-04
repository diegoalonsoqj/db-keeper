import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { APP_LOCALES, DEFAULT_LOCALE } from "@dbkeeper/shared";
import es419 from "./locales/es-419.json";
import en from "./locales/en.json";

const STORAGE_KEY = "dbkeeper.locale";

function initialLocale(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (APP_LOCALES as readonly string[]).includes(saved)) return saved;
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources: {
    "es-419": { translation: es419 },
    en: { translation: en },
  },
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => localStorage.setItem(STORAGE_KEY, lng));

export default i18n;
