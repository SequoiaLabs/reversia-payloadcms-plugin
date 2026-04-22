import type { CollectionConfig, Endpoint, GlobalConfig } from 'payload';
import type { InsertionResponse, LocalizedFieldInfo, ReversiaPluginConfig } from '../types.js';
import { unauthorizedResponse, validateApiKey } from '../utils/auth.js';
import {
  deflatePopulatedRelationships,
  deserializeFieldValue,
  findLocalizedFields,
} from '../utils/fields.js';

const WRITE_CONFLICT_MAX_RETRIES = 3;
const WRITE_CONFLICT_BASE_DELAY_MS = 50;

function isWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const message =
    'message' in error && typeof (error as { message: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  return message.includes('Write conflict') || message.includes('write conflict');
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < WRITE_CONFLICT_MAX_RETRIES && isWriteConflict(error)) {
        const delay = WRITE_CONFLICT_BASE_DELAY_MS * 2 ** attempt + Math.random() * WRITE_CONFLICT_BASE_DELAY_MS;

        await new Promise((resolve) => setTimeout(resolve, delay));
        
        continue;
      }
      throw error;
    }
  }
}

interface InsertionRequestItem {
  type: string;
  id?: string;
  sourceLocale: string;
  targetLocale: string;
  data: Record<string, unknown>;
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

function indexFieldsByName(fields: readonly LocalizedFieldInfo[]): Map<string, LocalizedFieldInfo> {
  const map = new Map<string, LocalizedFieldInfo>();
  for (const f of fields) {
    map.set(f.name, f);
  }
  return map;
}

interface ApplyParams {
  allowedFields: LocalizedFieldInfo[];
  data: Record<string, unknown>;
  sourceDoc: unknown;
  previousDoc: unknown;
}

interface ApplyResult {
  updateData: Record<string, unknown>;
  diff: Record<string, string>;
  acceptedFields: string[];
}

function applyTranslations({
  allowedFields,
  data,
  sourceDoc,
  previousDoc,
}: ApplyParams): ApplyResult {
  const fieldByName = indexFieldsByName(allowedFields);

  // Deflate the source doc ONCE before anything reads from it. Payload's
  // Lexical `afterRead` populates relationship/upload fields inside block
  // nodes even at `depth: 0`, and the internal `payloadDataLoader` cache can
  // serve a populated version from a prior higher-depth fetch. Deflating here
  // guarantees `deserializeFieldValue` sees plain string IDs everywhere — not
  // populated `{ id, filename, url }` objects that Payload's update validator
  // rejects.
  const cleanSource = sourceDoc ? deflatePopulatedRelationships(sourceDoc) : null;

  // Build updateData from fields Reversia sent, plus any required fields that
  // are empty in the target locale. Payload validates ALL required fields on
  // every update (not just the ones in `data`), so an empty required field in
  // the target locale would block the entire write. We seed those from source.
  const updateData: Record<string, unknown> = {};
  const diff: Record<string, string> = {};
  const acceptedFields: string[] = [];
  const previous = (previousDoc as Record<string, unknown> | null | undefined) ?? null;
  const source = (cleanSource as Record<string, unknown> | null | undefined) ?? null;
  const dataKeys = new Set(Object.keys(data));

  // Seed required fields that are empty in target and not being translated.
  for (const field of allowedFields) {
    if (!field.hasRequiredLeaf) {
      continue;
    }

    if (dataKeys.has(field.name)) {
      continue; // Reversia is sending it — will be handled below
    }

    const targetValue = previous ? previous[field.name] : undefined;

    if (targetValue !== undefined && targetValue !== null) {
      continue; // Target already has a value — don't overwrite
    }

    const sourceValue = source ? source[field.name] : undefined;

    if (sourceValue === undefined || sourceValue === null) {
      continue; // Source is also empty — nothing we can do
    }

    // Seed from source so Payload's required validation doesn't reject.
    updateData[field.name] = field.isContainer
      ? deflatePopulatedRelationships(structuredClone(sourceValue))
      : sourceValue;
  }

  for (const [fieldName, translatedValue] of Object.entries(data)) {
    const field = fieldByName.get(fieldName);

    if (!field) {
      continue;
    }

    const sourceValue = source ? source[fieldName] : undefined;
    const finalValue = deserializeFieldValue(field, sourceValue, translatedValue);

    updateData[fieldName] = finalValue;
    acceptedFields.push(fieldName);

    const prevValue = previous ? previous[fieldName] : undefined;

    if (prevValue === undefined || prevValue === null) {
      continue;
    }

    const prevString = stringifyDiffValue(prevValue);
    const newString = stringifyDiffValue(finalValue);

    if (prevString !== newString) {
      diff[fieldName] = prevString;
    }
  }

  return { updateData, diff, acceptedFields };
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

        if (!item || typeof item !== 'object') {
          response.errors.push(`Item ${index}: must be an object`);
          continue;
        }

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

            // depth: 0 is critical — without it, Payload populates relationship
            // and upload fields as full objects instead of raw IDs. Our clone
            // would then write those objects back, which Payload's validator
            // rejects with "invalid relationships: [object Object]".
            const [sourceDoc, previousDoc] = await Promise.all([
              req.payload.findGlobal({ slug: globalSlug, locale: item.sourceLocale, depth: 0 }),
              req.payload.findGlobal({ slug: globalSlug, locale: item.targetLocale, depth: 0 }),
            ]);

            const { updateData, diff, acceptedFields } = applyTranslations({
              allowedFields,
              data: item.data,
              sourceDoc,
              previousDoc,
            });

            if (acceptedFields.length === 0) {
              response.errors.push(
                `Item ${index}: no recognised fields in data (keys: ${Object.keys(item.data).join(', ')})`,
              );
              continue;
            }

            await withRetry(() =>
              req.payload.updateGlobal({
                slug: globalSlug,
                locale: item.targetLocale,
                data: updateData,
                context: { reversiaInsertion: true },
              }),
            );

            response[index] = { index, type: item.type, id: globalSlug, diff };
            continue;
          }

          if (!item.type.startsWith('payloadcms:')) {
            response.errors.push(`Item ${index}: unknown resourceType "${item.type}"`);
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

          const itemId = item.id;
          const allowedFields = findLocalizedFields(collection.fields);

          const [sourceDoc, previousDoc] = await Promise.all([
            req.payload.findByID({
              collection: slug,
              id: item.id,
              locale: item.sourceLocale,
              depth: 0,
            }),
            req.payload.findByID({
              collection: slug,
              id: item.id,
              locale: item.targetLocale,
              depth: 0,
            }),
          ]);

          const { updateData, diff, acceptedFields } = applyTranslations({
            allowedFields,
            data: item.data,
            sourceDoc,
            previousDoc,
          });

          if (acceptedFields.length === 0) {
            response.errors.push(
              `Item ${index}: no recognised fields in data (keys: ${Object.keys(item.data).join(', ')})`,
            );
            continue;
          }

          await withRetry(() =>
            req.payload.update({
              collection: slug,
              id: itemId,
              locale: item.targetLocale,
              data: updateData,
              context: { reversiaInsertion: true },
            }),
          );

          response[index] = { index, type: item.type, id: itemId, diff };
        } catch (error) {
          recordInsertionFailure(req, response, error, index, item);
        }
      }

      return Response.json(response);
    },
  };
}

/**
 * Payload's ValidationError stashes structured field-level diagnostics on
 * `error.data.errors` (`[{ field, message }]`). Pull them out so the Reversia
 * warn log carries enough context to pinpoint which field blew up on which
 * item without needing to tail the Payload server logs.
 */
function extractPayloadFieldErrors(
  error: unknown,
): Array<{ field: string; message: string }> | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const data = (error as { data?: unknown }).data;

  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const errors = (data as { errors?: unknown }).errors;

  if (!Array.isArray(errors)) {
    return undefined;
  }

  const out: Array<{ field: string; message: string }> = [];

  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const field = (entry as { field?: unknown; path?: unknown }).field;
    const path = (entry as { path?: unknown }).path;
    const message = (entry as { message?: unknown }).message;

    out.push({
      field: typeof field === 'string' ? field : typeof path === 'string' ? path : '(unknown)',
      message: typeof message === 'string' ? message : '(unknown)',
    });
  }

  return out.length > 0 ? out : undefined;
}

function recordInsertionFailure(
  req: { payload: { logger: { error: (...args: unknown[]) => void } } },
  response: InsertionResponse,
  error: unknown,
  index: number,
  item: InsertionRequestItem,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const fieldErrors = extractPayloadFieldErrors(error);

  req.payload.logger.error(
    {
      err: error,
      item: {
        type: item.type,
        id: item.id,
        targetLocale: item.targetLocale,
        dataKeys: Object.keys(item.data ?? {}),
      },
      fieldErrors,
    },
    '[reversia] insertion failed',
  );

  const fieldSummary = fieldErrors
    ? ` [${fieldErrors.map((e) => `${e.field}: ${e.message}`).join('; ')}]`
    : '';

  response.errors.push(
    `Item ${index} (${item.type}${item.id ? ` ${item.id}` : ''} → ${item.targetLocale}): ${message}${fieldSummary}`,
  );
}
