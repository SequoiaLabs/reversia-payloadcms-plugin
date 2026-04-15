import type { Endpoint } from 'payload';
import type { ReversiaPluginConfig } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';

interface LocaleConfig {
  code: string;
  label?: string | Record<string, string>;
}

export function createSettingsEndpoint(pluginConfig: ReversiaPluginConfig): Endpoint {
  return {
    path: '/reversia/settings',
    method: 'get',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse();
      }

      const localization = req.payload.config.localization;

      let languages: Array<{ code: string; label: string }> = [];

      if (localization && typeof localization === 'object' && 'locales' in localization) {
        const locales = (localization as { locales: LocaleConfig[] }).locales;
        languages = locales.map((locale) => {
          const label =
            typeof locale.label === 'string'
              ? locale.label
              : locale.label && typeof locale.label === 'object' && 'en' in locale.label
                ? String(locale.label.en)
                : locale.code;

          return { code: locale.code, label };
        });
      }

      const defaultLocale =
        localization && typeof localization === 'object' && 'defaultLocale' in localization
          ? String((localization as { defaultLocale: string }).defaultLocale)
          : 'en';

      return Response.json({
        platform: 'payloadcms',
        pluginVersion: '0.1.0',
        languages,
        defaultLocale,
      });
    },
  };
}
