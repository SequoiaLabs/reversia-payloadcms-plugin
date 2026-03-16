import type { Endpoint, CollectionConfig, Where } from 'payload'
import type { ReversiaPluginConfig, StreamResponse } from '../types.js'
import { validateApiKey, unauthorizedResponse } from '../utils/auth.js'
import { encodeCursor, decodeCursor } from '../utils/cursor.js'

export function createResourcesSyncEndpoint(
  pluginConfig: ReversiaPluginConfig,
  collectionsMap: Map<string, CollectionConfig>,
): Endpoint {
  return {
    path: '/reversia/resources-sync',
    method: 'get',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse()
      }

      const cursorParam = req.searchParams.get('cursor')
      const limitParam = req.searchParams.get('limit')
      const limit = limitParam ? parseInt(limitParam, 10) : 100

      const cursor = decodeCursor(cursorParam)

      const where: Where = {}

      if (cursor) {
        where.id = { greater_than: cursor.id }
      }

      const pendingDocs = await req.payload.find({
        collection: 'reversia-sync-pending',
        where,
        sort: 'id',
        limit,
      })

      if (pendingDocs.docs.length === 0) {
        return Response.json({ content: [], cursor: null } satisfies StreamResponse)
      }

      const grouped = new Map<string, string[]>()

      for (const doc of pendingDocs.docs) {
        const pending = doc as unknown as { resourceType: string; resourceId: string }
        const existing = grouped.get(pending.resourceType) ?? []
        existing.push(pending.resourceId)
        grouped.set(pending.resourceType, existing)
      }

      const content: StreamResponse['content'] = []

      for (const [resourceType, identifiers] of grouped) {
        content.push({
          type: resourceType,
          data: [{
            id: resourceType,
            content: { identifiers },
          }],
        })
      }

      const lastDoc = pendingDocs.docs[pendingDocs.docs.length - 1]
      const lastCursor = lastDoc
        ? encodeCursor('reversia-sync-pending', String(lastDoc.id))
        : null

      return Response.json({
        content,
        cursor: pendingDocs.docs.length >= limit ? lastCursor : null,
      } satisfies StreamResponse)
    },
  }
}
