/**
 * pluginI18n.ts — shared helper for resolving plugin/app display names
 * from the i18n mapping that plugins carry in their manifest.
 *
 * Plugins may provide ``name_i18n`` / ``description_i18n`` as
 * ``{ "zh-CN": "...", "en-US": "..." }`` mappings.  This helper picks
 * the best match for the current frontend language, falling back to
 * English, then to the first available value, and finally to the
 * provided default string.
 */

/**
 * Map frontend language codes to the locale keys used in plugin.json.
 * Frontend uses short codes (e.g. "zh", "ja"); plugin manifests tend
 * to use full locale tags (e.g. "zh-CN", "ja-JP").
 */
const LOCALE_FALLBACKS: Record<string, string[]> = {
  zh: ["zh-CN", "zh", "zh-TW", "zh-t"],
  "zh-t": ["zh-TW", "zh-t", "zh-CN", "zh"],
  en: ["en-US", "en"],
  ja: ["ja-JP", "ja"],
  ru: ["ru-RU", "ru"],
  fr: ["fr-FR", "fr"],
  es: ["es-ES", "es"],
  ar: ["ar-SA", "ar"],
  vi: ["vi-VN", "vi"],
  id: ["id-ID", "id"],
  "pt-BR": ["pt-BR", "pt"],
};

/**
 * Pick the best localised string from an i18n mapping.
 *
 * @param i18nMap  The ``{ locale: text }`` mapping from the manifest,
 *                 or ``null``/``undefined`` when the plugin has no i18n.
 * @param lang     Current frontend language code (e.g. "zh", "en").
 * @param fallback Default string when no match is found.
 */
export function pickLocalised(
  i18nMap: Record<string, string> | null | undefined,
  lang: string,
  fallback: string,
): string {
  if (!i18nMap || typeof i18nMap !== "object") return fallback;

  // Direct match (e.g. "en" → "en")
  if (i18nMap[lang]) return i18nMap[lang];

  // Try locale-specific fallbacks
  const candidates = LOCALE_FALLBACKS[lang] || [lang];
  for (const candidate of candidates) {
    if (i18nMap[candidate]) return i18nMap[candidate];
  }

  // Fallback to English, then to the first available value
  if (i18nMap["en-US"]) return i18nMap["en-US"];
  if (i18nMap["en"]) return i18nMap["en"];
  const values = Object.values(i18nMap);
  if (values.length > 0) return values[0];

  return fallback;
}
