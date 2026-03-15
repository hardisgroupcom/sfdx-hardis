import i18next from 'i18next';
import * as path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

let initialized = false;

function loadTranslations(locale: string): Record<string, string> {
  try {
    // Try to load from the built lib directory first, then from src
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const localeFile = path.join(__dirname, '..', '..', 'i18n', `${locale}.json`);
    if (fs.existsSync(localeFile)) {
      return JSON.parse(fs.readFileSync(localeFile, 'utf-8'));
    }
  } catch {
    // Ignore errors and fall back to empty translations
  }
  return {};
}

export function initI18n(): void {
  if (initialized) {
    return;
  }
  /** Keep the format for i18next. e.g: en, es, pt-BR... */
  const locale = (process.env.SFDX_HARDIS_LANG || 'en').substring(0, 5).replace(/^([a-zA-Z]{2})(-?)([a-zA-Z]{0,2})$/, (_, p1, p2, p3) =>
    p1.toLowerCase() + p2 + p3.toUpperCase()
  );
  const supportedLocales = ['de', 'en', 'es', 'fr', 'ja', 'pl', 'pt-BR'];
  const lng = supportedLocales.includes(locale) ? locale : 'en';

  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: loadTranslations('en') },
  };
  if (lng !== 'en') {
    resources[lng] = { translation: loadTranslations(lng) };
  }

  i18next.init({
    lng,
    fallbackLng: 'en',
    resources,
    interpolation: {
      escapeValue: false,
    },
    showSupportNotice: false,
  });
  initialized = true;
}

export function reinitI18n(): void {
  initialized = false;
  initI18n();
}

/**
 * Translate a message key with optional interpolation variables.
 * Falls back to the key itself if no translation is found.
 * The locale is controlled by the SFDX_HARDIS_LOCALE environment variable (e.g. "fr" for French).
 * @param key - Translation key
 * @param vars - Optional interpolation variables
 * @returns Translated string, or the key if not found
 */
export function t(key: string, vars?: Record<string, unknown>): string {
  if (!initialized) {
    initI18n();
  }
  const result = i18next.t(key, vars as any);
  // If i18next returns the key itself (not found), return the key as fallback
  return result as string;
}
