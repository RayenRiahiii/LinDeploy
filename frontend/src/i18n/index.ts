import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import fr from "./locales/fr";

const STORAGE_KEY = "lindeploy_language";

const savedLanguage = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "fr" || stored === "en") {
      return stored;
    }
  } catch {
    // fallback if localStorage is blocked
  }
  return "en";
})();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: savedLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export function setAppLanguage(lang: "en" | "fr") {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore storage error
  }
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

export default i18n;
