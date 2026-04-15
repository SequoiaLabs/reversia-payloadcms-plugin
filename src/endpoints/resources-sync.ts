import type { CollectionConfig, Endpoint, Where } from 'payload';
import type { ReversiaPluginConfig, StreamResponse } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { parseLimit } from '../utils/payload-helpers.js';

export function createResourcesSyncEndpoint(
  pluginConfig: ReversiaPluginConfig,
  _collectionsMap: Map<string, CollectionConfig>,
): Endpoint {
  return {
    path: '/reversia/resources-sync',
    method: 'get',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse();
      }

      const cursorParam = req.searchParams.get('cursor');
      const limit = parseLimit(req.searchParams.get('limit'));
      const cursor = decodeCursor(cursorParam);

      const where: Where = {};

      if (cursor) {
        // Cursor.id carries the `updatedAt` checkpoint as an ISO string.
        where.updatedAt = { greater_than: cursor.id };
      }

      const pendingDocs = await req.payload.find({
        collection: 'reversia-sync-pending',
        where,
        sort: 'updatedAt',
        limit,
      });

      if (pendingDocs.docs.length === 0) {
        return Response.json({ content: [], cursor: null } satisfies StreamResponse);
      }

      const grouped = new Map<string, string[]>();

      for (const doc of pendingDocs.docs) {
        const pending = doc as unknown as { resourceType: string; resourceId: string };
        const existing = grouped.get(pending.resourceType) ?? [];
        existing.push(pending.resourceId);
        grouped.set(pending.resourceType, existing);
      }

      const content: StreamResponse['content'] = [];

      for (const [resourceType, identifiers] of grouped) {
        content.push({
          type: resourceType,
          data: [
            {
              id: resourceType,
              content: { identifiers },
            },
          ],
        });
      }

      const lastDoc = pendingDocs.docs[pendingDocs.docs.length - 1] as unknown as {
        updatedAt: string | Date;
      };
      const lastUpdatedAt =
        typeof lastDoc.updatedAt === 'string'
          ? lastDoc.updatedAt
          : new Date(lastDoc.updatedAt).toISOString();
      const lastCursor = encodeCursor('reversia-sync-pending', lastUpdatedAt);

      return Response.json({
        content,
        cursor: lastCursor,
      } satisfies StreamResponse);
    },
  };
}
