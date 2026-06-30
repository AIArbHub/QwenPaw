import { Dropdown } from "@agentscope-ai/design";
import { useTranslation } from "react-i18next";
import { Button, type MenuProps } from "antd";
import { languageApi } from "../../api/modules/language";
import styles from "./index.module.less";
import {
  SparkChinese02Line,
  SparkEnglishLine,
  SparkJapanLine,
  SparkRusLine,
  SparkPtLine,
} from "@agentscope-ai/icons";

interface LanguageConfig {
  key: string;
  label: string;
  icon?: React.ReactElement;
  flag?: string;
}

export const LANGUAGE_LIST: LanguageConfig[] = [
  { key: "en", label: "English", icon: <SparkEnglishLine /> },
  { key: "zh", label: "简体中文", icon: <SparkChinese02Line /> },
  { key: "zh-t", label: "繁體中文", icon: <SparkChinese02Line /> },
  { key: "ja", label: "日本語", icon: <SparkJapanLine /> },
  { key: "ru", label: "Русский", icon: <SparkRusLine /> },
  { key: "pt-BR", label: "Português (Brasil)", icon: <SparkPtLine /> },
  { key: "id", label: "Bahasa Indonesia", flag: "🇮🇩" },
  { key: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { key: "fr", label: "Français", flag: "🇫🇷" },
  { key: "es", label: "Español", flag: "🇪🇸" },
  { key: "ar", label: "العربية", flag: "🇸🇦" },
];

const KNOWN_LANG_KEYS = new Set(LANGUAGE_LIST.map((lang) => lang.key));

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const currentLanguage = i18n.resolvedLanguage || i18n.language;
  // Exact match first, then try prefix (e.g., zh-TW -> zh), then fallback to en
  const currentLangKey = KNOWN_LANG_KEYS.has(currentLanguage)
    ? currentLanguage
    : currentLanguage.split("-")[0] === "zh"
    ? "zh-t"
    : KNOWN_LANG_KEYS.has(currentLanguage.split("-")[0])
    ? currentLanguage.split("-")[0]
    : "en";

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("language", lang);
    languageApi
      .updateLanguage(lang)
      .catch((err) =>
        console.error("Failed to save language preference:", err),
      );
  };

  const items: MenuProps["items"] = LANGUAGE_LIST.map(
    ({ key, label, icon, flag }) => ({
      key,
      label:
        icon || flag ? (
          <span className={styles.menuItemLabel}>
            {icon}
            {!icon && flag && <span className={styles.flagEmoji}>{flag}</span>}
            {label}
          </span>
        ) : (
          label
        ),
      onClick: () => changeLanguage(key),
    }),
  );

  const iconMap: Record<string, React.ReactElement> = {};
  const flagMap: Record<string, string> = {};
  for (const lang of LANGUAGE_LIST) {
    if (lang.icon) iconMap[lang.key] = lang.icon;
    if (lang.flag) flagMap[lang.key] = lang.flag;
  }

  const currentIcon = iconMap[currentLangKey];
  const currentFlag = flagMap[currentLangKey];

  return (
    <Dropdown
      menu={{ items, selectedKeys: [currentLangKey] }}
      placement="bottomRight"
      overlayClassName={styles.languageDropdown}
    >
      <Button icon={currentIcon || undefined} className={styles.trigger}>
        {!currentIcon && currentFlag && (
          <span className={styles.flagEmoji}>{currentFlag}</span>
        )}
      </Button>
    </Dropdown>
  );
}
