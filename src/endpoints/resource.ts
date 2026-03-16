import type { Endpoint, CollectionConfig, GlobalConfig } from 'payload'
import type { ReversiaPluginConfig } from '../types.js'
import { validateApiKey, unauthorizedResponse } from '../utils/auth.js'
import { findLocalizedFields, getContentType } from '../utils/fields.js'

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }

    current = (current as Record<string, unknown>)[part]
  }

  return current
}

export function createResourceEndpoint(
  pluginConfig: ReversiaPluginConfig,
  collectionsMap: Map<string, CollectionConfig>,
  globalsMap: Map<string, GlobalConfig>,
): Endpoint {
  return {
    path: '/reversia/resource',
    method: 'get',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse()
      }

      const resourceType = req.searchParams.get('resourceType')
      const resourceId = req.searchParams.get('resourceId')

      if (!resourceType) {
        return Response.json({ error: 'resourceType is required' }, { status: 400 })
      }

      const localization = req.payload.config.localization
      const defaultLocale = localization && typeof localization === 'object' && 'defaultLocale' in localization
        ? String((localization as { defaultLocale: string }).defaultLocale)
        : 'en'

      if (resourceType.startsWith('payloadcms:global:')) {
        const globalSlug = resourceType.replace('payloadcms:global:', '')
        const globalConfig = globalsMap.get(globalSlug)

        if (!globalConfig) {
          return Response.json({ error: `Global ${globalSlug} not found` }, { status: 404 })
        }

        const localizedFields = findLocalizedFields(globalConfig.fields)
        const doc = await req.payload.findGlobal({
          slug: globalSlug,
          locale: defaultLocale,
        })

        const content: Record<string, unknown> = {}
        const contentTypes: Record<string, string> = {}

        for (const field of localizedFields) {
          const value = getNestedValue(doc as unknown as Record<string, unknown>, field.path)

          if (value !== undefined && value !== null) {
            content[field.path] = value
          }

          const ct = getContentType(field)

          if (ct) {
            contentTypes[field.path] = ct
          }
        }

        return Response.json({
          id: globalSlug,
          content,
          contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
        })
      }

      const slug = resourceType.replace('payloadcms:', '')
      const collection = collectionsMap.get(slug)

      if (!collection) {
        return Response.json({ error: `Collection ${slug} not found` }, { status: 404 })
      }

      if (!resourceId) {
        return Response.json({ error: 'resourceId is required for collection resources' }, { status: 400 })
      }

      const localizedFields = findLocalizedFields(collection.fields)

      const doc = await req.payload.findByID({
        collection: slug,
        id: resourceId,
        locale: defaultLocale,
      })

      const content: Record<string, unknown> = {}
      const contentTypes: Record<string, string> = {}

      for (const field of localizedFields) {
        const value = getNestedValue(doc as unknown as Record<string, unknown>, field.path)

        if (value !== undefined && value !== null) {
          content[field.path] = value
        }

        const ct = getContentType(field)

        if (ct) {
          contentTypes[field.path] = ct
        }
      }

      const labelField = localizedFields.find((f) => f.name === 'title' || f.name === 'name')
      const label = labelField
        ? getNestedValue(doc as unknown as Record<string, unknown>, labelField.path)
        : undefined

      return Response.json({
        id: String(doc.id),
        label: typeof label === 'string' ? label : undefined,
        content,
        contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
      })
    },
  }
}
