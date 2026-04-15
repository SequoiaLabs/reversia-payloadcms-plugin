import type { CollectionConfig, Endpoint, GlobalConfig, Where } from 'payload';
import type {
  LocalizedFieldInfo,
  ResourceItem,
  ReversiaPluginConfig,
  StreamResponse,
} from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import { findLocalizedFields, serializeField } from '../utils/fields.js';
import { resolveValues } from '../utils/path-resolver.js';
import { parseLimit, resolveDefaultLocale } from '../utils/payload-helpers.js';

function extractLocalizedContent(
  doc: unknown,
  fields: LocalizedFieldInfo[],
): { content: Record<string, unknown>; contentTypes: Record<string, string> } {
  const content: Record<string, unknown> = {};
  const contentTypes: Record<string, string> = {};

  for (const field of fields) {
    const entries = serializeField(field, doc);

    for (const entry of entries) {
      content[entry.indexedPath] = entry.value;

      if (entry.contentType) {
        contentTypes[entry.indexedPath] = entry.contentType;
      }
    }
  }

  return { content, contentTypes };
}

function getLabelValue(doc: unknown, fields: LocalizedFieldInfo[]): string | undefined {
  const labelField = fields.find(
    (f) => !f.hasArrayContainer && (f.name === 'title' || f.name === 'name'),
  );

  if (!labelField) {
    return undefined;
  }

  const resolved = resolveValues(doc, labelField.segments);
  const value = resolved[0]?.value;

  return typeof value === 'string' ? value : undefined;
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
        return unauthorizedResponse();
      }

      const typesParam = req.searchParams.get('types');
      const cursorParam = req.searchParams.get('cursor');
      const limit = parseLimit(req.searchParams.get('limit'));

      const cursor = decodeCursor(cursorParam);
      const requestedTypes = typesParam ? typesParam.split(',').filter(Boolean) : null;
      const defaultLocale = resolveDefaultLocale(req);

      const response: StreamResponse = { content: [], cursor: null };
      let totalFetched = 0;
      let lastType: string | null = null;
      let lastId: string | null = null;
      let startFromCursor = !cursor;

      for (const [slug, collection] of collectionsMap) {
        const resourceType = `payloadcms:${slug}`;

        if (requestedTypes && !requestedTypes.includes(resourceType)) {
          continue;
        }

        if (!startFromCursor) {
          if (cursor && cursor.type === resourceType) {
            startFromCursor = true;
          } else {
            continue;
          }
        }

        if (totalFetched >= limit) {
          break;
        }

        const localizedFields = findLocalizedFields(collection.fields);

        if (localizedFields.length === 0) {
          continue;
        }

        const where: Where = {};

        if (cursor && cursor.type === resourceType && cursor.id) {
          where.id = { greater_than: cursor.id };
        }

        const docs = await req.payload.find({
          collection: slug,
          locale: defaultLocale,
          limit: limit - totalFetched,
          sort: 'id',
          where,
        });

        if (docs.docs.length === 0) {
          continue;
        }

        const items: ResourceItem[] = [];

        for (const doc of docs.docs) {
          const { content, contentTypes } = extractLocalizedContent(doc, localizedFields);

          if (Object.keys(content).length === 0) {
            continue;
          }

          items.push({
            id: String(doc.id),
            label: getLabelValue(doc, localizedFields),
            content,
            contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
          });

          lastType = resourceType;
          lastId = String(doc.id);
          totalFetched++;
        }

        if (items.length > 0) {
          response.content.push({ type: resourceType, data: items });
        }
      }

      if (lastType && lastId && totalFetched >= limit) {
        response.cursor = encodeCursor(lastType, lastId);
      }

      return Response.json(response);
    },
  };
}
