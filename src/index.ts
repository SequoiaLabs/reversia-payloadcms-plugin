import type { Config, CollectionConfig, GlobalConfig } from 'payload'
import type { ReversiaPluginConfig } from './types.js'
import { reversiaSyncPendingCollection } from './collections/sync-pending.js'
import { createAfterChangeHook } from './hooks/after-change.js'
import { findLocalizedFields } from './utils/fields.js'
import { createResourcesDefinitionEndpoint } from './endpoints/resources-definition.js'
import { createResourcesEndpoint } from './endpoints/resources.js'
import { createResourcesSyncEndpoint } from './endpoints/resources-sync.js'
import { createResourceEndpoint } from './endpoints/resource.js'
import { createResourcesInsertEndpoint } from './endpoints/resources-insert.js'
import { createConfirmResourcesSyncEndpoint } from './endpoints/confirm-resources-sync.js'
import { createSettingsEndpoint } from './endpoints/settings.js'

export type { ReversiaPluginConfig, ReversiaFieldCustom } from './types.js'
export { ReversiaFieldType, ReversiaFieldBehavior } from './types.js'

export const reversiaPlugin = (pluginConfig: ReversiaPluginConfig) => (config: Config): Config => {
  if (pluginConfig.disabled) {
    return config
  }

  const collectionsMap = new Map<string, CollectionConfig>()
  const globalsMap = new Map<string, GlobalConfig>()

  const collections = [...(config.collections ?? [])]

  for (const collection of collections) {
    if (pluginConfig.enabledCollections && !pluginConfig.enabledCollections.includes(collection.slug as never)) {
      continue
    }

    const localizedFields = findLocalizedFields(collection.fields)

    if (localizedFields.length === 0) {
      continue
    }

    collectionsMap.set(collection.slug, collection)
  }

  const globals = [...(config.globals ?? [])]

  for (const global of globals) {
    if (pluginConfig.enabledGlobals && !pluginConfig.enabledGlobals.includes(global.slug)) {
      continue
    }

    const localizedFields = findLocalizedFields(global.fields)

    if (localizedFields.length === 0) {
      continue
    }

    globalsMap.set(global.slug, global)
  }

  config.collections = collections.map((collection) => {
    if (!collectionsMap.has(collection.slug)) {
      return collection
    }

    const resourceType = `payloadcms:${collection.slug}`

    return {
      ...collection,
      hooks: {
        ...(collection.hooks ?? {}),
        afterChange: [
          ...(collection.hooks?.afterChange ?? []),
          createAfterChangeHook(resourceType),
        ],
      },
    }
  })

  config.collections = [...(config.collections ?? []), reversiaSyncPendingCollection]

  config.endpoints = [
    ...(config.endpoints ?? []),
    createResourcesDefinitionEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourcesEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourcesSyncEndpoint(pluginConfig, collectionsMap),
    createResourceEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourcesInsertEndpoint(pluginConfig, collectionsMap, globalsMap),
    createConfirmResourcesSyncEndpoint(pluginConfig),
    createSettingsEndpoint(pluginConfig),
  ]

  return config
}

export default reversiaPlugin
