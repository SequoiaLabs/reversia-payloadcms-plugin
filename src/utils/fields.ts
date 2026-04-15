import type { Field } from 'payload';
import type { LocalizedFieldInfo, ReversiaFieldCustom, TranslatableFieldConfig } from '../types.js';
import { type ReversiaFieldBehavior, ReversiaFieldType } from '../types.js';
import {
  applyByKeys,
  compileKeyMatcher,
  DEFAULT_RICHTEXT_KEYS,
  extractByKeys,
} from './json-extract.js';
import { resolveStaticLabel } from './labels.js';
import { type PathSegment, resolveValues, segmentsToTemplatePath } from './path-resolver.js';

function getFieldLabel(field: Field): string {
  if (!('name' in field)) {
    return '';
  }

  const name = String(field.name ?? '');

  if ('label' in field && field.label) {
    return resolveStaticLabel(field.label, name);
  }

  return '';
}

function getReversiaCustom(field: Field): ReversiaFieldCustom | undefined {
  if ('custom' in field && field.custom && typeof field.custom === 'object') {
    const custom = field.custom as Record<string, unknown>;

    if (custom.reversia && typeof custom.reversia === 'object') {
      return custom.reversia as ReversiaFieldCustom;
    }
  }

  return undefined;
}

function hasSubFields(field: Field): field is Field & { fields: Field[] } {
  return 'fields' in field && Array.isArray((field as Record<string, unknown>).fields);
}

function isTabsField(
  field: Field,
): field is Field & { tabs: Array<{ fields: Field[]; label?: string; name?: string }> } {
  return field.type === 'tabs' && 'tabs' in field;
}

function isBlocksField(
  field: Field,
): field is Field & { blocks: Array<{ slug: string; fields: Field[] }> } {
  return field.type === 'blocks' && 'blocks' in field;
}

function isArrayField(field: Field): field is Field & { fields: Field[] } {
  return field.type === 'array' && 'fields' in field;
}

export function findLocalizedFields(
  fields: Field[],
  parentSegments: readonly PathSegment[] = [],
): LocalizedFieldInfo[] {
  const result: LocalizedFieldInfo[] = [];

  for (const field of fields) {
    if (!('name' in field) || !field.name) {
      if (isTabsField(field)) {
        for (const tab of field.tabs) {
          // Named tabs introduce a key segment; unnamed tabs are transparent.
          const tabSegments: readonly PathSegment[] =
            'name' in tab && typeof tab.name === 'string' && tab.name.length > 0
              ? [...parentSegments, { kind: 'key', name: tab.name }]
              : parentSegments;
          result.push(...findLocalizedFields(tab.fields, tabSegments));
        }
      }

      if (hasSubFields(field)) {
        result.push(...findLocalizedFields(field.fields, parentSegments));
      }

      continue;
    }

    const isLocalized =
      'localized' in field && (field as Record<string, unknown>).localized === true;
    const nextKeySegment: PathSegment = { kind: 'key', name: field.name };
    const thisSegments: PathSegment[] = [...parentSegments, nextKeySegment];

    if (isLocalized) {
      result.push(buildFieldInfo(field, thisSegments));
    }

    if (isArrayField(field)) {
      const arraySegments: PathSegment[] = [...parentSegments, { kind: 'array', name: field.name }];
      result.push(...findLocalizedFields(field.fields, arraySegments));
      continue;
    }

    if (isBlocksField(field)) {
      for (const block of field.blocks) {
        const blockSegments: PathSegment[] = [
          ...parentSegments,
          { kind: 'block', name: field.name, blockSlug: block.slug },
        ];
        result.push(...findLocalizedFields(block.fields, blockSegments));
      }
      continue;
    }

    if (hasSubFields(field)) {
      result.push(...findLocalizedFields(field.fields, thisSegments));
    }
  }

  return result;
}

function buildFieldInfo(field: Field, segments: PathSegment[]): LocalizedFieldInfo {
  const name = 'name' in field && field.name ? String(field.name) : '';
  const path = segmentsToTemplatePath(segments);
  const hasArrayContainer = segments.some((s) => s.kind !== 'key');

  return {
    name,
    path,
    segments,
    label: getFieldLabel(field),
    type: field.type,
    payloadFieldType: field.type,
    isNested: segments.length > 1,
    hasArrayContainer,
    reversia: getReversiaCustom(field),
  };
}

/**
 * Resolves the Reversia content type for a field.
 *
 * Priority:
 * 1. Explicit `custom.reversia.type` annotation
 * 2. Inferred from PayloadCMS field type (richText → JSON, json → JSON)
 * 3. undefined (plain text, no annotation needed)
 */
export function resolveContentType(field: LocalizedFieldInfo): ReversiaFieldType | undefined {
  if (field.reversia?.type) {
    return field.reversia.type;
  }

  if (field.payloadFieldType === 'richText' || field.payloadFieldType === 'json') {
    return ReversiaFieldType.JSON;
  }

  return undefined;
}

function resolveBehavior(field: LocalizedFieldInfo): ReversiaFieldBehavior | undefined {
  return field.reversia?.behavior;
}

function resolveAsLabel(field: LocalizedFieldInfo, hasLabelAlready: boolean): boolean {
  if (field.reversia?.asLabel !== undefined) {
    return field.reversia.asLabel;
  }

  if (
    !hasLabelAlready &&
    !field.hasArrayContainer &&
    (field.name === 'title' || field.name === 'name')
  ) {
    return true;
  }

  return false;
}

function humanize(segment: string): string {
  const spaced = segment
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  if (spaced.length === 0) {
    return segment;
  }

  return spaced
    .split(' ')
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function buildNestedLabel(field: LocalizedFieldInfo): string {
  const fieldLabel = field.label || humanize(field.name);
  const segments = field.path.split('.');

  if (segments.length <= 1) {
    return fieldLabel;
  }

  const parentSegments = segments.slice(0, -1).map(humanize);

  return `${parentSegments.join(' > ')} > ${fieldLabel}`;
}

export function buildTranslatableConfiguration(
  localizedFields: LocalizedFieldInfo[],
): Record<string, TranslatableFieldConfig> {
  const config: Record<string, TranslatableFieldConfig> = {};
  let hasLabelField = false;

  for (const field of localizedFields) {
    const fieldConfig: TranslatableFieldConfig = {
      label: field.isNested ? buildNestedLabel(field) : field.label || humanize(field.name),
    };

    const isLabel = resolveAsLabel(field, hasLabelField);

    if (isLabel) {
      fieldConfig.asLabel = true;
      hasLabelField = true;
    }

    const contentType = resolveContentType(field);

    if (contentType) {
      fieldConfig.type = contentType;
    }

    const behavior = resolveBehavior(field);

    if (behavior) {
      fieldConfig.behavior = behavior;
    }

    if (field.reversia?.selected === false) {
      fieldConfig.selected = false;
    }

    config[field.path] = fieldConfig;
  }

  return config;
}

// Re-export for callers that only need the content-type resolver.
export const getContentType = resolveContentType;

/**
 * Serialises a field value for shipping to Reversia.
 *
 * Strategy per field:
 * 1. If `custom.reversia.extract` is set → use it directly.
 * 2. If the field is object-shaped (richText/json or a raw object value) →
 *    extract only leaf strings whose key path matches `translatableKeys`
 *    (defaults to `['text', 'url', 'alt']` for richText, required for json).
 * 3. Otherwise → passthrough (plain text).
 *
 * Returns `undefined` when there is nothing translatable to send.
 */
export function serializeFieldValue(
  field: LocalizedFieldInfo,
  value: unknown,
): string | number | boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const custom = field.reversia;

  if (custom?.extract) {
    if (!custom.apply) {
      throw new Error(
        `reversia.extract on field "${field.path}" requires a matching reversia.apply.`,
      );
    }
    return custom.extract(value);
  }

  if (typeof value !== 'object') {
    return value as string | number | boolean;
  }

  const keys = resolveTranslatableKeys(field);

  if (!keys) {
    return JSON.stringify(value);
  }

  const matcher = compileKeyMatcher(keys);
  const extracted = extractByKeys(value, matcher);

  if (Object.keys(extracted).length === 0) {
    return undefined;
  }

  return JSON.stringify(extracted);
}

/**
 * Reverses `serializeFieldValue`.
 */
export function deserializeFieldValue(
  field: LocalizedFieldInfo,
  sourceValue: unknown,
  translatedRaw: unknown,
): unknown {
  const custom = field.reversia;

  if (custom?.apply) {
    const asString =
      typeof translatedRaw === 'string' ? translatedRaw : JSON.stringify(translatedRaw);
    return custom.apply(sourceValue, asString);
  }

  if (typeof sourceValue !== 'object' || sourceValue === null) {
    return translatedRaw;
  }

  const keys = resolveTranslatableKeys(field);

  if (!keys) {
    if (typeof translatedRaw === 'string') {
      try {
        return JSON.parse(translatedRaw);
      } catch {
        return translatedRaw;
      }
    }

    return translatedRaw;
  }

  const translations = coerceTranslationMap(translatedRaw);

  if (!translations) {
    return sourceValue;
  }

  return applyByKeys(sourceValue, translations);
}

function resolveTranslatableKeys(field: LocalizedFieldInfo): string[] | null {
  const explicit = field.reversia?.translatableKeys;

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  if (field.payloadFieldType === 'richText') {
    return [...DEFAULT_RICHTEXT_KEYS];
  }

  return null;
}

function coerceTranslationMap(raw: unknown): Record<string, string> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};

    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out[k] = v;
      }
    }

    return out;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};

        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string') {
            out[k] = v;
          }
        }

        return out;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export interface SerialisedFieldEntry {
  /** Indexed path in the document (e.g. `items.0.title`). */
  indexedPath: string;
  /** Serialised value to ship to Reversia. */
  value: string | number | boolean;
  /** Resolved content type, if any. */
  contentType?: ReversiaFieldType;
}

/**
 * Walks the document for a single localized field, returning every translatable
 * leaf value produced by the field's structural path. For scalar fields
 * (no array/blocks segments) this returns at most one entry; for array/blocks
 * fields it returns one entry per array item that matched.
 */
export function serializeField(field: LocalizedFieldInfo, doc: unknown): SerialisedFieldEntry[] {
  const results: SerialisedFieldEntry[] = [];
  const resolved = resolveValues(doc, field.segments);

  if (resolved.length === 0) {
    return results;
  }

  const contentType = resolveContentType(field);

  for (const { indexedPath, value } of resolved) {
    const serialised = serializeFieldValue(field, value);

    if (serialised === undefined) {
      continue;
    }

    results.push({ indexedPath, value: serialised, contentType });
  }

  return results;
}
