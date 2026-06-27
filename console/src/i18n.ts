import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";
import zhTW from "./locales/zh-t.json";
import ja from "./locales/ja.json";
import ptBR from "./locales/pt-BR.json";
import id from "./locales/id.json";
import vi from "./locales/vi.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import ar from "./locales/ar.json";

const resources = {
  en: {
    translation: en,
  },
  ru: {
    translation: ru,
  },
  zh: {
    translation: zh,
  },
  "zh-t": {
    translation: zhTW,
  },
  ja: {
    translation: ja,
  },
  "pt-BR": {
    translation: ptBR,
  },
  id: {
    translation: id,
  },
  vi: {
    translation: vi,
  },
  fr: {
    translation: fr,
  },
  es: {
    translation: es,
  },
  ar: {
    translation: ar,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem("language") || navigator.language || "en",
  fallbackLng: "en",
  supportedLngs: Object.keys(resources),
  nonExplicitSupportedLngs: true,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
