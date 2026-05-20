import type { CollectionConfig, Config, GlobalConfig } from 'payload';
import { reversiaSyncPendingCollection } from './collections/sync-pending';
import { createConfirmResourcesSyncEndpoint } from './endpoints/confirm-resources-sync';
import { createResourceEndpoint } from './endpoints/resource';
import { createResourcesEndpoint } from './endpoints/resources';
import { createResourcesDefinitionEndpoint } from './endpoints/resources-definition';
import { createResourcesInsertEndpoint } from './endpoints/resources-insert';
import { createResourcesSyncEndpoint } from './endpoints/resources-sync';
import { createSettingsEndpoint } from './endpoints/settings';
import { createTriggerCrawlDashboardEndpoint } from './endpoints/trigger-crawl-dashboard';
import { createAfterChangeHook } from './hooks/after-change';
import type { ReversiaPluginConfig } from './types';
import { findLocalizedFields } from './utils/fields';

export type { TriggerCrawlOptions, TriggerCrawlResult } from './trigger-crawl';
export { triggerCrawl } from './trigger-crawl';
export type {
  ConfirmResourcesSyncResponse,
  InsertionRequest,
  InsertionResponse,
  ResourceDefinition,
  ResourceItem,
  ResourceResponse,
  ReversiaErrorResponse,
  ReversiaFieldCustom,
  ReversiaPluginConfig,
  SettingsResponse,
  StreamResponse,
  TranslatableFieldConfig,
} from './types';
export { ReversiaFieldBehavior, ReversiaFieldType } from './types';

const APPLIED_MARKER = Symbol.for('payload-plugin-reversia.applied');

type MaybeMarkedConfig = Config & { [APPLIED_MARKER]?: boolean };

export const reversiaPlugin =
  (pluginConfig: ReversiaPluginConfig) =>
  (config: Config): Config => {
    if (pluginConfig.disabled) {
      return config;
    }

    if (typeof pluginConfig.apiKey !== 'string' || pluginConfig.apiKey.length === 0) {
      throw new Error(
        '[reversia] apiKey is required. Set `ReversiaPluginConfig.apiKey` to a non-empty string.',
      );
    }

    const marked = config as MaybeMarkedConfig;

    if (marked[APPLIED_MARKER]) {
      return config;
    }

    marked[APPLIED_MARKER] = true;

    const enabledCollectionSlugs = pluginConfig.enabledCollections
      ? new Set(pluginConfig.enabledCollections.map((s) => String(s)))
      : null;
    const enabledGlobalSlugs = pluginConfig.enabledGlobals
      ? new Set(pluginConfig.enabledGlobals)
      : null;

    const collectionsMap = new Map<string, CollectionConfig>();
    const globalsMap = new Map<string, GlobalConfig>();

    const collections = [...(config.collections ?? [])];

    for (const collection of collections) {
      if (enabledCollectionSlugs && !enabledCollectionSlugs.has(collection.slug)) {
        continue;
      }

      if (findLocalizedFields(collection.fields).length === 0) {
        continue;
      }

      collectionsMap.set(collection.slug, collection);
    }

    const globals = [...(config.globals ?? [])];

    for (const global of globals) {
      if (enabledGlobalSlugs && !enabledGlobalSlugs.has(global.slug)) {
        continue;
      }

      if (findLocalizedFields(global.fields).length === 0) {
        continue;
      }

      globalsMap.set(global.slug, global);
    }

    config.collections = collections.map((collection) => {
      if (!collectionsMap.has(collection.slug)) {
        return collection;
      }

      const resourceType = `payloadcms:${collection.slug}`;

      return {
        ...collection,
        hooks: {
          ...(collection.hooks ?? {}),
          afterChange: [
            ...(collection.hooks?.afterChange ?? []),
            createAfterChangeHook(resourceType),
          ],
        },
      };
    });

    config.collections = [...(config.collections ?? []), reversiaSyncPendingCollection];

    config.endpoints = [
      ...(config.endpoints ?? []),
      createResourcesDefinitionEndpoint(pluginConfig, collectionsMap, globalsMap),
      createResourcesEndpoint(pluginConfig, collectionsMap, globalsMap),
      createResourcesSyncEndpoint(pluginConfig, collectionsMap),
      createResourceEndpoint(pluginConfig, collectionsMap, globalsMap),
      createResourcesInsertEndpoint(pluginConfig, collectionsMap, globalsMap),
      createConfirmResourcesSyncEndpoint(pluginConfig),
      createSettingsEndpoint(pluginConfig),
      createTriggerCrawlDashboardEndpoint(pluginConfig),
    ];

    return config;
  };

export default reversiaPlugin;
