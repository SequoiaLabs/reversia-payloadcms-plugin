import type { CollectionConfig, Endpoint, GlobalConfig } from 'payload';
import type { LocalizedFieldInfo, ReversiaPluginConfig } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import { findLocalizedFields, serializeField } from '../utils/fields.js';
import { resolveValues } from '../utils/path-resolver.js';
import { resolveDefaultLocale } from '../utils/payload-helpers.js';

function extract(doc: unknown, fields: LocalizedFieldInfo[]) {
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

  const value = resolveValues(doc, labelField.segments)[0]?.value;

  return typeof value === 'string' ? value : undefined;
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
        return unauthorizedResponse();
      }

      const resourceType = req.searchParams.get('resourceType');
      const resourceId = req.searchParams.get('resourceId');

      if (!resourceType || resourceType.length === 0) {
        return Response.json({ error: 'resourceType is required' }, { status: 400 });
      }

      const defaultLocale = resolveDefaultLocale(req);

      if (resourceType.startsWith('payloadcms:global:')) {
        const globalSlug = resourceType.slice('payloadcms:global:'.length);
        const globalConfig = globalsMap.get(globalSlug);

        if (!globalConfig) {
          return Response.json({ error: `Global ${globalSlug} not found` }, { status: 404 });
        }

        const localizedFields = findLocalizedFields(globalConfig.fields);
        const doc = await req.payload.findGlobal({ slug: globalSlug, locale: defaultLocale });
        const { content, contentTypes } = extract(doc, localizedFields);

        return Response.json({
          id: globalSlug,
          content,
          contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
        });
      }

      if (!resourceType.startsWith('payloadcms:')) {
        return Response.json({ error: 'Unknown resourceType' }, { status: 400 });
      }

      const slug = resourceType.slice('payloadcms:'.length);
      const collection = collectionsMap.get(slug);

      if (!collection) {
        return Response.json({ error: `Collection ${slug} not found` }, { status: 404 });
      }

      if (!resourceId || resourceId.length === 0) {
        return Response.json(
          { error: 'resourceId is required for collection resources' },
          { status: 400 },
        );
      }

      const localizedFields = findLocalizedFields(collection.fields);

      const doc = await req.payload.findByID({
        collection: slug,
        id: resourceId,
        locale: defaultLocale,
      });

      const { content, contentTypes } = extract(doc, localizedFields);

      return Response.json({
        id: String(doc.id),
        label: getLabelValue(doc, localizedFields),
        content,
        contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
      });
    },
  };
}
