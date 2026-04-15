import type { Endpoint } from 'payload';
import type { ReversiaPluginConfig } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import { decodeCursor } from '../utils/cursor.js';

export function createConfirmResourcesSyncEndpoint(pluginConfig: ReversiaPluginConfig): Endpoint {
  return {
    path: '/reversia/confirm-resources-sync',
    method: 'post',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse();
      }

      const body =
        (req.data as { cursor?: string } | undefined) ??
        ((req.json ? await req.json() : undefined) as { cursor?: string } | undefined);

      if (!body?.cursor) {
        return Response.json({ error: 'cursor is required' }, { status: 400 });
      }

      const cursor = decodeCursor(body.cursor);

      if (!cursor) {
        return Response.json({ error: 'Invalid cursor' }, { status: 400 });
      }

      // Rows edited after the cursor have a later `updatedAt` and must survive.
      // Using timestamp comparison is portable across Mongo/Postgres/SQLite —
      // id reuse on SQLite would silently corrupt the queue.
      const result = await req.payload.delete({
        collection: 'reversia-sync-pending',
        where: { updatedAt: { less_than_equal: cursor.id } },
      });

      const deleted = Array.isArray(result.docs) ? result.docs.length : 0;

      return Response.json({ success: true, deleted });
    },
  };
}
