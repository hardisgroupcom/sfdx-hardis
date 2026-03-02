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
  const locale = (process.env.SFDX_HARDIS_LOCALE || 'en').substring(0, 2).toLowerCase();
  const supportedLocales = ['en', 'fr'];
  const lng = supportedLocales.includes(locale) ? locale : 'en';

  i18next.init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: loadTranslations('en') },
      fr: { translation: loadTranslations('fr') },
    },
    interpolation: {
      escapeValue: false,
    },
  });
  initialized = true;
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
