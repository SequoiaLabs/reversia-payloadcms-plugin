import type { CollectionConfig, Config, GlobalConfig } from 'payload';
import { reversiaSyncPendingCollection } from './collections/sync-pending.js';
import { createConfirmResourcesSyncEndpoint } from './endpoints/confirm-resources-sync.js';
import { createResourceEndpoint } from './endpoints/resource.js';
import { createResourcesEndpoint } from './endpoints/resources.js';
import { createResourcesDefinitionEndpoint } from './endpoints/resources-definition.js';
import { createResourcesInsertEndpoint } from './endpoints/resources-insert.js';
import { createResourcesSyncEndpoint } from './endpoints/resources-sync.js';
import { createSettingsEndpoint } from './endpoints/settings.js';
import { createAfterChangeHook } from './hooks/after-change.js';
import type { ReversiaPluginConfig } from './types.js';
import { findLocalizedFields } from './utils/fields.js';

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
} from './types.js';
export { ReversiaFieldBehavior, ReversiaFieldType } from './types.js';

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
    ];

    return config;
  };

export default reversiaPlugin;
