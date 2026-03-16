import type { Endpoint, CollectionConfig, GlobalConfig, Where } from 'payload'
import type { ReversiaPluginConfig, ResourceItem, StreamResponse } from '../types.js'
import { validateApiKey, unauthorizedResponse } from '../utils/auth.js'
import { findLocalizedFields, getContentType } from '../utils/fields.js'
import { encodeCursor, decodeCursor } from '../utils/cursor.js'

function extractLocalizedContent(
  doc: Record<string, unknown>,
  fields: ReturnType<typeof findLocalizedFields>,
): { content: Record<string, unknown>; contentTypes: Record<string, string> } {
  const content: Record<string, unknown> = {}
  const contentTypes: Record<string, string> = {}

  for (const field of fields) {
    const value = getNestedValue(doc, field.path)

    if (value !== undefined && value !== null) {
      content[field.path] = value
    }

    const ct = getContentType(field)

    if (ct) {
      contentTypes[field.path] = ct
    }
  }

  return { content, contentTypes }
}

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

function getLabelValue(
  doc: Record<string, unknown>,
  fields: ReturnType<typeof findLocalizedFields>,
): string | undefined {
  const labelField = fields.find((f) => f.name === 'title' || f.name === 'name')

  if (labelField) {
    const value = getNestedValue(doc, labelField.path)

    return typeof value === 'string' ? value : undefined
  }

  return undefined
}

export function createResourcesEndpoint(
  pluginConfig: ReversiaPluginConfig,
  collectionsMap: Map<string, CollectionConfig>,
  _globalsMap: Map<string, GlobalConfig>,
): Endpoint {
  return {
    path: '/reversia/resources',
    method: 'get',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse()
      }

      const typesParam = req.searchParams.get('types')
      const cursorParam = req.searchParams.get('cursor')
      const limitParam = req.searchParams.get('limit')
      const limit = limitParam ? parseInt(limitParam, 10) : 100

      const cursor = decodeCursor(cursorParam)
      const requestedTypes = typesParam ? typesParam.split(',') : null

      const localization = req.payload.config.localization
      const defaultLocale = localization && typeof localization === 'object' && 'defaultLocale' in localization
        ? String((localization as { defaultLocale: string }).defaultLocale)
        : 'en'

      const response: StreamResponse = { content: [], cursor: null }
      let totalFetched = 0
      let lastType: string | null = null
      let lastId: string | null = null
      let startFromCursor = !cursor

      for (const [slug, collection] of collectionsMap) {
        const resourceType = `payloadcms:${slug}`

        if (requestedTypes && !requestedTypes.includes(resourceType)) {
          continue
        }

        if (!startFromCursor) {
          if (cursor && cursor.type === resourceType) {
            startFromCursor = true
          } else {
            continue
          }
        }

        if (totalFetched >= limit) {
          break
        }

        const localizedFields = findLocalizedFields(collection.fields)

        if (localizedFields.length === 0) {
          continue
        }

        const where: Where = {}

        if (cursor && cursor.type === resourceType && cursor.id) {
          where.id = { greater_than: cursor.id }
        }

        const docs = await req.payload.find({
          collection: slug,
          locale: defaultLocale,
          limit: limit - totalFetched,
          sort: 'id',
          where,
        })

        if (docs.docs.length === 0) {
          continue
        }

        const items: ResourceItem[] = []

        for (const doc of docs.docs) {
          const { content, contentTypes } = extractLocalizedContent(
            doc as unknown as Record<string, unknown>,
            localizedFields,
          )

          if (Object.keys(content).length === 0) {
            continue
          }

          items.push({
            id: String(doc.id),
            label: getLabelValue(doc as unknown as Record<string, unknown>, localizedFields),
            content,
            contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
          })

          lastType = resourceType
          lastId = String(doc.id)
          totalFetched++
        }

        if (items.length > 0) {
          response.content.push({ type: resourceType, data: items })
        }
      }

      if (lastType && lastId && totalFetched >= limit) {
        response.cursor = encodeCursor(lastType, lastId)
      }

      return Response.json(response)
    },
  }
}
