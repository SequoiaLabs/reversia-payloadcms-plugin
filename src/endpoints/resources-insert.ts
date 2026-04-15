import type { CollectionConfig, Endpoint, GlobalConfig } from 'payload';
import type { InsertionResponse, LocalizedFieldInfo, ReversiaPluginConfig } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import { deserializeFieldValue, findLocalizedFields } from '../utils/fields.js';
import {
  getAtIndexedPath,
  indexedPathMatchesSegments,
  setAtIndexedPath,
} from '../utils/path-resolver.js';

interface InsertionRequestItem {
  type: string;
  id?: string;
  sourceLocale: string;
  targetLocale: string;
  data: Record<string, unknown>;
}

interface ResolvedDataEntry {
  indexedPath: string;
  field: LocalizedFieldInfo;
  translated: unknown;
}

function fieldNeedsSource(field: LocalizedFieldInfo): boolean {
  if (field.reversia?.apply) {
    return true;
  }

  if (field.reversia?.translatableKeys && field.reversia.translatableKeys.length > 0) {
    return true;
  }

  return field.payloadFieldType === 'richText';
}

function stringifyDiffValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function matchField(
  fields: readonly LocalizedFieldInfo[],
  indexedPath: string,
): LocalizedFieldInfo | undefined {
  for (const field of fields) {
    if (indexedPathMatchesSegments(indexedPath, field.segments)) {
      return field;
    }
  }

  return undefined;
}

function resolveEntries(
  fields: readonly LocalizedFieldInfo[],
  data: Record<string, unknown>,
): ResolvedDataEntry[] {
  const entries: ResolvedDataEntry[] = [];

  for (const [key, value] of Object.entries(data)) {
    const field = matchField(fields, key);

    if (!field) {
      continue;
    }

    entries.push({ indexedPath: key, field, translated: value });
  }

  return entries;
}

async function applyInsertion(params: {
  entries: ResolvedDataEntry[];
  sourceDoc: unknown;
  previousDoc: unknown;
}): Promise<{ updateData: Record<string, unknown>; diff: Record<string, string> }> {
  const { entries, sourceDoc, previousDoc } = params;
  const updateData: Record<string, unknown> = {};
  const diff: Record<string, string> = {};

  for (const { indexedPath, field, translated } of entries) {
    const sourceValue = getAtIndexedPath(sourceDoc, indexedPath);
    const finalValue = fieldNeedsSource(field)
      ? deserializeFieldValue(field, sourceValue, translated)
      : translated;

    setAtIndexedPath(updateData, sourceDoc, indexedPath, finalValue);

    const prevValue = getAtIndexedPath(previousDoc, indexedPath);

    if (prevValue === null || prevValue === undefined) {
      continue;
    }

    const prevString = stringifyDiffValue(prevValue);

    if (prevString !== stringifyDiffValue(translated)) {
      diff[indexedPath] = prevString;
    }
  }

  return { updateData, diff };
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
        return unauthorizedResponse();
      }

      const body =
        (req.data as InsertionRequestItem[] | undefined) ??
        ((req.json ? await req.json() : undefined) as InsertionRequestItem[] | undefined);

      if (!Array.isArray(body)) {
        return Response.json({ error: 'Request body must be an array' }, { status: 400 });
      }

      const response: InsertionResponse = { errors: [] };

      for (let index = 0; index < body.length; index++) {
        const item = body[index];

        if (!item.type) {
          response.errors.push(`Item ${index}: type is required`);
          continue;
        }

        if (!item.targetLocale) {
          response.errors.push(`Item ${index}: targetLocale is required`);
          continue;
        }

        if (!item.data || typeof item.data !== 'object') {
          response.errors.push(`Item ${index}: data is required and must be an object`);
          continue;
        }

        try {
          if (item.type.startsWith('payloadcms:global:')) {
            const globalSlug = item.type.slice('payloadcms:global:'.length);
            const globalConfig = globalsMap.get(globalSlug);

            if (!globalConfig) {
              response.errors.push(`Item ${index}: global ${globalSlug} not found`);
              continue;
            }

            const allowedFields = findLocalizedFields(globalConfig.fields);
            const entries = resolveEntries(allowedFields, item.data);
            const needsSource = entries.some((e) => fieldNeedsSource(e.field));

            const sourceDoc = needsSource
              ? await req.payload.findGlobal({ slug: globalSlug, locale: item.sourceLocale })
              : null;

            const previousDoc = await req.payload.findGlobal({
              slug: globalSlug,
              locale: item.targetLocale,
            });

            const { updateData, diff } = await applyInsertion({
              entries,
              sourceDoc,
              previousDoc,
            });

            await req.payload.updateGlobal({
              slug: globalSlug,
              locale: item.targetLocale,
              data: updateData,
              context: { reversiaInsertion: true },
            });

            response[index] = { index, type: item.type, id: globalSlug, diff };
            continue;
          }

          if (!item.type.startsWith('payloadcms:')) {
            response.errors.push(`Item ${index}: unknown resourceType`);
            continue;
          }

          const slug = item.type.slice('payloadcms:'.length);
          const collection = collectionsMap.get(slug);

          if (!collection) {
            response.errors.push(`Item ${index}: collection ${slug} not found`);
            continue;
          }

          if (!item.id) {
            response.errors.push(`Item ${index}: id is required for collection resources`);
            continue;
          }

          const allowedFields = findLocalizedFields(collection.fields);
          const entries = resolveEntries(allowedFields, item.data);
          const needsSource = entries.some((e) => fieldNeedsSource(e.field));

          const sourceDoc = needsSource
            ? await req.payload.findByID({
                collection: slug,
                id: item.id,
                locale: item.sourceLocale,
              })
            : null;

          const previousDoc = await req.payload.findByID({
            collection: slug,
            id: item.id,
            locale: item.targetLocale,
          });

          const { updateData, diff } = await applyInsertion({
            entries,
            sourceDoc,
            previousDoc,
          });

          await req.payload.update({
            collection: slug,
            id: item.id,
            locale: item.targetLocale,
            data: updateData,
            context: { reversiaInsertion: true },
          });

          response[index] = { index, type: item.type, id: item.id, diff };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          response.errors.push(`Item ${index}: ${message}`);
        }
      }

      return Response.json(response);
    },
  };
}
