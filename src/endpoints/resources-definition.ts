import type { CollectionConfig, Endpoint, GlobalConfig } from 'payload';
import type { ResourceDefinition, ReversiaPluginConfig } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import { buildTranslatableConfiguration, findLocalizedFields } from '../utils/fields.js';
import { resolveStaticLabel } from '../utils/labels.js';

export function createResourcesDefinitionEndpoint(
  pluginConfig: ReversiaPluginConfig,
  collectionsMap: Map<string, CollectionConfig>,
  globalsMap: Map<string, GlobalConfig>,
): Endpoint {
  return {
    path: '/reversia/resources-definition',
    method: 'get',
    handler: async (req) => {
      if (!validateApiKey(req, pluginConfig.apiKey)) {
        return unauthorizedResponse();
      }

      const definitions: ResourceDefinition[] = [];

      for (const [slug, collection] of collectionsMap) {
        const localizedFields = findLocalizedFields(collection.fields);

        if (localizedFields.length === 0) {
          continue;
        }

        const count = await req.payload.count({ collection: slug });

        definitions.push({
          type: `payloadcms:${slug}`,
          label: {
            singular: resolveStaticLabel(collection.labels?.singular, slug),
            plural: resolveStaticLabel(collection.labels?.plural, slug),
          },
          group: 'payloadcms',
          version: '1.0.0',
          configuration: buildTranslatableConfiguration(localizedFields),
          configurationType: 'MULTIPLE',
          count: count.totalDocs,
          synchronizable: true,
        });
      }

      for (const [slug, global] of globalsMap) {
        const localizedFields = findLocalizedFields(global.fields);

        if (localizedFields.length === 0) {
          continue;
        }

        definitions.push({
          type: `payloadcms:global:${slug}`,
          label: {
            singular: resolveStaticLabel(global.label, slug),
            plural: resolveStaticLabel(global.label, slug),
          },
          group: 'payloadcms',
          version: '1.0.0',
          configuration: buildTranslatableConfiguration(localizedFields),
          configurationType: 'ENTITY',
          synchronizable: true,
        });
      }

      return Response.json(definitions);
    },
  };
}
