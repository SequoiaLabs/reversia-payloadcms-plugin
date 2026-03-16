import type { Endpoint, CollectionConfig, GlobalConfig } from 'payload'
import type { ReversiaPluginConfig, InsertionResponse } from '../types.js'
import { validateApiKey, unauthorizedResponse } from '../utils/auth.js'
import { findLocalizedFields } from '../utils/fields.js'

interface InsertionRequestItem {
  type: string
  id?: string
  sourceLocale: string
  targetLocale: string
  data: Record<string, unknown>
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')

  if (parts.length === 1) {
    obj[parts[0]] = value
    return
  }

  let current = obj

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]

    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }

    current = current[part] as Record<string, unknown>
  }

  current[parts[parts.length - 1]] = value
}

export function createResourcesInsertEndpoint(
  pluginConfig: ReversiaPluginConfig,
  collectionsMap: Map<string, CollectionConfig>,
  globalsMap: Map<string, GlobalConfig>,
): Endpoint {
  return {
    path: '/reversia/resources-insert',
    method: 'put',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse()
      }

      const body = req.data as InsertionRequestItem[] | undefined
        ?? (req.json ? await req.json() : undefined) as InsertionRequestItem[] | undefined

      if (!Array.isArray(body)) {
        return Response.json({ error: 'Request body must be an array' }, { status: 400 })
      }

      const response: InsertionResponse = { errors: [] }

      for (let index = 0; index < body.length; index++) {
        const item = body[index]

        if (!item.type) {
          response.errors.push(`Item ${index}: type is required`)
          continue
        }

        if (!item.targetLocale) {
          response.errors.push(`Item ${index}: targetLocale is required`)
          continue
        }

        if (!item.data || typeof item.data !== 'object') {
          response.errors.push(`Item ${index}: data is required and must be an object`)
          continue
        }

        try {
          if (item.type.startsWith('payloadcms:global:')) {
            const globalSlug = item.type.replace('payloadcms:global:', '')
            const globalConfig = globalsMap.get(globalSlug)

            if (!globalConfig) {
              response.errors.push(`Item ${index}: global ${globalSlug} not found`)
              continue
            }

            const allowedFields = findLocalizedFields(globalConfig.fields)
            const allowedPaths = new Set(allowedFields.map((f) => f.path))
            const updateData: Record<string, unknown> = {}

            for (const [key, value] of Object.entries(item.data)) {
              if (allowedPaths.has(key)) {
                setNestedValue(updateData, key, value)
              }
            }

            const previousDoc = await req.payload.findGlobal({
              slug: globalSlug,
              locale: item.targetLocale,
            })

            await req.payload.updateGlobal({
              slug: globalSlug,
              locale: item.targetLocale,
              data: updateData,
              context: { reversiaInsertion: true },
            })

            const diff: Record<string, unknown> = {}

            for (const key of Object.keys(item.data)) {
              if (allowedPaths.has(key)) {
                const prevValue = (previousDoc as unknown as Record<string, unknown>)[key]

                if (prevValue !== item.data[key]) {
                  diff[key] = prevValue
                }
              }
            }

            response[index] = {
              index,
              type: item.type,
              id: globalSlug,
              diff,
            }

            continue
          }

          const slug = item.type.replace('payloadcms:', '')
          const collection = collectionsMap.get(slug)

          if (!collection) {
            response.errors.push(`Item ${index}: collection ${slug} not found`)
            continue
          }

          if (!item.id) {
            response.errors.push(`Item ${index}: id is required for collection resources`)
            continue
          }

          const allowedFields = findLocalizedFields(collection.fields)
          const allowedPaths = new Set(allowedFields.map((f) => f.path))
          const updateData: Record<string, unknown> = {}

          for (const [key, value] of Object.entries(item.data)) {
            if (allowedPaths.has(key)) {
              setNestedValue(updateData, key, value)
            }
          }

          const previousDoc = await req.payload.findByID({
            collection: slug,
            id: item.id,
            locale: item.targetLocale,
          })

          await req.payload.update({
            collection: slug,
            id: item.id,
            locale: item.targetLocale,
            data: updateData,
            context: { reversiaInsertion: true },
          })

          const diff: Record<string, unknown> = {}

          for (const key of Object.keys(item.data)) {
            if (allowedPaths.has(key)) {
              const prevValue = (previousDoc as unknown as Record<string, unknown>)[key]

              if (prevValue !== item.data[key]) {
                diff[key] = prevValue
              }
            }
          }

          response[index] = {
            index,
            type: item.type,
            id: item.id,
            diff,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          response.errors.push(`Item ${index}: ${message}`)
        }
      }

      return Response.json(response)
    },
  }
}
