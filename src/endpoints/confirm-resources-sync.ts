import type { Endpoint } from 'payload'
import type { ReversiaPluginConfig } from '../types.js'
import { validateApiKey, unauthorizedResponse } from '../utils/auth.js'
import { decodeCursor } from '../utils/cursor.js'

export function createConfirmResourcesSyncEndpoint(
  pluginConfig: ReversiaPluginConfig,
): Endpoint {
  return {
    path: '/reversia/confirm-resources-sync',
    method: 'post',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse()
      }

      const body = req.data as { cursor?: string } | undefined
        ?? (req.json ? await req.json() : undefined) as { cursor?: string } | undefined

      if (!body?.cursor) {
        return Response.json({ error: 'cursor is required' }, { status: 400 })
      }

      const cursor = decodeCursor(body.cursor)

      if (!cursor) {
        return Response.json({ error: 'Invalid cursor' }, { status: 400 })
      }

      const pendingDocs = await req.payload.find({
        collection: 'reversia-sync-pending',
        where: {
          id: { less_than_equal: cursor.id },
        },
        limit: 10000,
      })

      for (const doc of pendingDocs.docs) {
        await req.payload.delete({
          collection: 'reversia-sync-pending',
          id: doc.id,
        })
      }

      return Response.json(true)
    },
  }
}
