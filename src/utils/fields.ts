import type { Field } from 'payload';
import type {
  LocalizedFieldInfo,
  LocalizedLeaf,
  ReversiaFieldCustom,
  TranslatableFieldConfig,
} from '../types.js';
import { type ReversiaFieldBehavior, ReversiaFieldType } from '../types.js';
import {
  applyByKeys,
  compileKeyMatcher,
  DEFAULT_RICHTEXT_KEYS,
  extractByKeys,
} from './json-extract.js';
import { resolveStaticLabel } from './labels.js';
import {
  applyTranslationsToContainer,
  joinPointers,
  type LeafSegment,
  resolveLeafLocations,
} from './path-resolver.js';

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

function isLocalized(field: Field): boolean {
  return 'localized' in field && (field as Record<string, unknown>).localized === true;
}

function isNamed(field: Field): field is Field & { name: string } {
  return 'name' in field && typeof field.name === 'string' && field.name.length > 0;
}

function isTabsField(
  field: Field,
): field is Field & { tabs: Array<{ fields: Field[]; name?: string; label?: string }> } {
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

function isGroupLikeField(field: Field): field is Field & { fields: Field[] } {
  return (
    (field.type === 'group' || field.type === 'collapsible' || field.type === 'row') &&
    'fields' in field &&
    Array.isArray((field as Record<string, unknown>).fields)
  );
}

const SCALAR_PAYLOAD_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'code',
  'date',
  'number',
  'select',
  'checkbox',
  'radio',
  'point',
]);

function isScalarPayloadType(type: string): boolean {
  return SCALAR_PAYLOAD_TYPES.has(type);
}

function getNumericProp(field: Field, prop: string): number | undefined {
  const val = (field as Record<string, unknown>)[prop];
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function getBoolProp(field: Field, prop: string): boolean | undefined {
  const val = (field as Record<string, unknown>)[prop];
  return typeof val === 'boolean' ? val : undefined;
}

/* -------------------------------------------------------------------------- */
/*  Discovery: top-level localized fields                                     */
/* -------------------------------------------------------------------------- */

/**
 * Collects one `LocalizedFieldInfo` per top-level field that is itself
 * localized OR that contains at least one localized descendant.
 *
 * Top-level localized scalars become non-container entries. Everything else
 * (richText, json, group, array, blocks, or any unnamed wrapper containing
 * localized descendants) becomes a container with one or more `leaves`.
 */
export function findLocalizedFields(fields: Field[]): LocalizedFieldInfo[] {
  const out: LocalizedFieldInfo[] = [];

  for (const field of flattenTransparentWrappers(fields)) {
    if (!isNamed(field)) {
      continue;
    }

    const info = describeTopLevelField(field);

    if (info) {
      out.push(info);
    }
  }

  return out;
}

/**
 * `tabs` (when unnamed), `row`, `collapsible` and similar wrappers don't
 * introduce a key in the document. Flatten them so their inner fields are
 * treated as top-level for discovery.
 */
function flattenTransparentWrappers(fields: Field[]): Field[] {
  const out: Field[] = [];

  for (const field of fields) {
    if (isTabsField(field)) {
      for (const tab of field.tabs) {
        if ('name' in tab && typeof tab.name === 'string' && tab.name.length > 0) {
          // A named tab IS a top-level container in its own right.
          out.push({
            name: tab.name,
            type: 'group',
            label: tab.label,
            fields: tab.fields,
          } as unknown as Field);
        } else {
          out.push(...flattenTransparentWrappers(tab.fields));
        }
      }
      continue;
    }

    if (!isNamed(field) && (field.type === 'row' || field.type === 'collapsible')) {
      if ('fields' in field && Array.isArray((field as Record<string, unknown>).fields)) {
        out.push(...flattenTransparentWrappers((field as { fields: Field[] }).fields));
      }
      continue;
    }

    out.push(field);
  }

  return out;
}

function describeTopLevelField(field: Field & { name: string }): LocalizedFieldInfo | null {
  const name = field.name;
  const label = getFieldLabel(field);
  const reversia = getReversiaCustom(field);
  const payloadFieldType = field.type;

  // Top-level scalar that is itself localized → non-container, value shipped
  // as a primitive.
  if (isLocalized(field) && isScalarPayloadType(payloadFieldType)) {
    const maxLength = getNumericProp(field, 'maxLength');
    const minLength = getNumericProp(field, 'minLength');
    const required = getBoolProp(field, 'required');

    return {
      name,
      label,
      payloadFieldType,
      isContainer: false,
      reversia,
      leaves: [
        {
          segments: [],
          kind: 'scalar',
          payloadFieldType,
          reversia,
        },
      ],
      ...(maxLength !== undefined && { maxLength }),
      ...(minLength !== undefined && { minLength }),
      ...(required && { hasRequiredLeaf: true }),
    };
  }

  // Top-level richText / json (localized or not localized but containing
  // sub-extractions — currently we only look at the field itself for these)
  // → container with one json leaf.
  if (payloadFieldType === 'richText' || payloadFieldType === 'json') {
    if (!isLocalized(field)) {
      return null;
    }

    return {
      name,
      label,
      payloadFieldType,
      isContainer: true,
      reversia,
      leaves: [
        {
          segments: [],
          kind: 'json',
          payloadFieldType,
          reversia,
        },
      ],
      ...(getBoolProp(field, 'required') && { hasRequiredLeaf: true }),
    };
  }

  // Structured wrapper: group / array / blocks. Walk inside to collect
  // localized descendant leaves; emit a container only if any were found.
  const innerLeaves: LocalizedLeaf[] = [];

  if (isGroupLikeField(field)) {
    collectLeaves(field.fields, [], innerLeaves);
  } else if (isArrayField(field)) {
    collectLeaves(field.fields, [{ kind: 'iterate' }], innerLeaves);
  } else if (isBlocksField(field)) {
    for (const block of field.blocks) {
      collectLeaves(block.fields, [{ kind: 'iterateBlock', blockSlug: block.slug }], innerLeaves);
    }
  } else {
    return null;
  }

  if (innerLeaves.length === 0) {
    return null;
  }

  return {
    name,
    label,
    payloadFieldType,
    isContainer: true,
    reversia,
    leaves: innerLeaves,
    // Containers (arrays, blocks, groups) almost always have required inner
    // subfields we can't cheaply enumerate. Marking hasRequiredLeaf ensures we
    // always seed empty target-locale containers from source so Payload's
    // whole-document required-field validation doesn't reject the update.
    hasRequiredLeaf: true,
  };
}

function collectLeaves(fields: Field[], parentSegments: LeafSegment[], out: LocalizedLeaf[]): void {
  for (const field of fields) {
    if (!isNamed(field)) {
      if (isTabsField(field)) {
        for (const tab of field.tabs) {
          const tabSegments: LeafSegment[] =
            'name' in tab && typeof tab.name === 'string' && tab.name.length > 0
              ? [...parentSegments, { kind: 'key', name: tab.name }]
              : parentSegments;
          collectLeaves(tab.fields, tabSegments, out);
        }
      }

      if (
        (field.type === 'row' || field.type === 'collapsible') &&
        'fields' in field &&
        Array.isArray((field as Record<string, unknown>).fields)
      ) {
        collectLeaves((field as { fields: Field[] }).fields, parentSegments, out);
      }

      continue;
    }

    const segments: LeafSegment[] = [...parentSegments, { kind: 'key', name: field.name }];
    const reversia = getReversiaCustom(field);
    const localized = isLocalized(field);

    if (localized && isScalarPayloadType(field.type)) {
      out.push({
        segments,
        kind: 'scalar',
        payloadFieldType: field.type,
        reversia,
      });
      continue;
    }

    if (localized && (field.type === 'richText' || field.type === 'json')) {
      out.push({
        segments,
        kind: 'json',
        payloadFieldType: field.type,
        reversia,
      });
      continue;
    }

    if (isGroupLikeField(field)) {
      collectLeaves(field.fields, segments, out);
      continue;
    }

    if (isArrayField(field)) {
      collectLeaves(field.fields, [...segments, { kind: 'iterate' }], out);
      continue;
    }

    if (isBlocksField(field)) {
      for (const block of field.blocks) {
        collectLeaves(
          block.fields,
          [...segments, { kind: 'iterateBlock', blockSlug: block.slug }],
          out,
        );
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Configuration (resources-definition)                                      */
/* -------------------------------------------------------------------------- */

export function resolveContentType(field: LocalizedFieldInfo): ReversiaFieldType | undefined {
  if (field.reversia?.type) {
    return field.reversia.type;
  }

  if (field.isContainer) {
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

  if (!hasLabelAlready && !field.isContainer && (field.name === 'title' || field.name === 'name')) {
    return true;
  }

  return false;
}

function resolveRules(
  field: LocalizedFieldInfo,
): { maxLength?: number; minLength?: number } | undefined {
  // Rules only make sense for non-container scalars — containers ship as JSON
  // pointer maps where the concept of "max length" doesn't apply at the
  // top-level entry.
  if (field.isContainer) {
    return undefined;
  }

  const maxLength = field.maxLength;
  const minLength = field.minLength;

  if (maxLength === undefined && minLength === undefined) {
    return undefined;
  }

  const rules: { maxLength?: number; minLength?: number } = {};

  if (maxLength !== undefined) {
    rules.maxLength = maxLength;
  }

  if (minLength !== undefined) {
    rules.minLength = minLength;
  }

  return rules;
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

export function buildTranslatableConfiguration(
  localizedFields: LocalizedFieldInfo[],
): Record<string, TranslatableFieldConfig> {
  const config: Record<string, TranslatableFieldConfig> = {};
  let hasLabelField = false;

  for (const field of localizedFields) {
    const fieldConfig: TranslatableFieldConfig = {
      label: field.label || humanize(field.name),
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

    const rules = resolveRules(field);

    if (rules) {
      fieldConfig.rules = rules;
    }

    config[field.name] = fieldConfig;
  }

  return config;
}

// Back-compat re-export for callers that only need the content-type resolver.
export const getContentType = resolveContentType;

export interface SerialisedFieldEntry {
  /** Top-level field name; doubles as the key in `content` and `contentTypes`. */
  name: string;
  /** Serialised value to ship to Reversia. */
  value: string | number | boolean;
  /** Resolved Reversia content type, if any. */
  contentType?: ReversiaFieldType;
}

/**
 * Produces zero or one serialised entry for a top-level localized field.
 *
 * - Scalars: pass-through primitive value (or `extract` result).
 * - Containers: walk every localized leaf, build a JSON-pointer map of only
 *   the translatable atoms (so we never ship non-localized siblings or fields
 *   the user opted out of), JSON.stringify and emit one entry.
 *
 * Returns `undefined` when there is nothing translatable to send (empty
 * source value, no matching leaves, or filtered out).
 */
export function serializeField(
  field: LocalizedFieldInfo,
  doc: unknown,
): SerialisedFieldEntry | undefined {
  const value = (doc as Record<string, unknown> | null | undefined)?.[field.name];

  if (value === undefined || value === null) {
    return undefined;
  }

  const contentType = resolveContentType(field);

  // Top-level extract escape hatch wins.
  if (field.reversia?.extract) {
    if (!field.reversia.apply) {
      throw new Error(
        `reversia.extract on field "${field.name}" requires a matching reversia.apply.`,
      );
    }

    const extracted = field.reversia.extract(value);

    if (extracted === undefined || extracted === null || extracted.length === 0) {
      return undefined;
    }

    return { name: field.name, value: extracted, contentType };
  }

  if (!field.isContainer) {
    if (typeof value === 'object') {
      // Defensive: top-level scalar shouldn't have an object value but if it
      // does we ship a JSON.stringify rather than an opaque [object Object].
      return { name: field.name, value: JSON.stringify(value), contentType };
    }

    return { name: field.name, value: value as string | number | boolean, contentType };
  }

  const map = extractContainerAtoms(field, value);

  if (Object.keys(map).length === 0) {
    return undefined;
  }

  return { name: field.name, value: JSON.stringify(map), contentType };
}

/**
 * Walks every localized leaf inside a container value and aggregates atomic
 * translatable strings into a single `{ pointer: value }` map. Non-localized
 * sibling fields and structural keys are pre-filtered — Reversia never sees
 * anything we don't ask it to translate.
 */
function extractContainerAtoms(
  field: LocalizedFieldInfo,
  containerValue: unknown,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const leaf of field.leaves) {
    const locations = resolveLeafLocations(containerValue, leaf.segments);

    for (const { pointer, value } of locations) {
      if (value === undefined || value === null) {
        continue;
      }

      if (leaf.kind === 'scalar') {
        if (typeof value === 'string') {
          if (value.length > 0) {
            map[pointer === '' ? '' : pointer] = value;
          }
          continue;
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
          map[pointer === '' ? '' : pointer] = String(value);
        }

        continue;
      }

      // leaf.kind === 'json' — extract sub-leaves by translatableKeys
      const subKeys = resolveTranslatableKeys(leaf);

      if (typeof value !== 'object') {
        // Unexpected primitive in a richText/json leaf — ship as-is.
        if (typeof value === 'string' && value.length > 0) {
          map[pointer === '' ? '' : pointer] = value;
        }
        continue;
      }

      if (!subKeys) {
        // json leaf with no keys configured: ship the whole serialised value
        // at the leaf's pointer so it round-trips intact.
        map[pointer === '' ? '' : pointer] = JSON.stringify(value);
        continue;
      }

      const matcher = compileKeyMatcher(subKeys);
      const sub = extractByKeys(value, matcher);

      for (const [subPointer, subValue] of Object.entries(sub)) {
        map[joinPointers(pointer, subPointer)] = subValue;
      }
    }
  }

  return map;
}

function resolveTranslatableKeys(leaf: LocalizedLeaf): string[] | null {
  const explicit = leaf.reversia?.translatableKeys;

  if (explicit && explicit.length > 0) {
    return explicit;
  }

  if (leaf.payloadFieldType === 'richText') {
    return [...DEFAULT_RICHTEXT_KEYS];
  }

  return null;
}

/**
 * Reverses `serializeField` for one top-level field.
 *
 * - Scalars: return `translatedRaw` as-is (after `apply` if defined).
 * - Containers: parse the JSON pointer map; deep-clone the source-locale
 *   container value as the base; overlay each translated leaf at its pointer.
 *   For `json` sub-leaves the pointer is split between the leaf location and
 *   the sub-extraction pointer — `applyByKeys` replays the standard richText
 *   path on the leaf's value before we re-attach it.
 *
 * The source-clone strategy guarantees required non-localized siblings (block
 * structure, array item ids, sub-object scaffolding) are preserved when we
 * write to Payload — same pattern as the PrestaShop module.
 */
export function deserializeFieldValue(
  field: LocalizedFieldInfo,
  sourceValue: unknown,
  translatedRaw: unknown,
): unknown {
  if (field.reversia?.apply) {
    const asString =
      typeof translatedRaw === 'string' ? translatedRaw : JSON.stringify(translatedRaw);
    return field.reversia.apply(sourceValue, asString);
  }

  if (!field.isContainer) {
    return translatedRaw;
  }

  const translations = coerceTranslationMap(translatedRaw);

  if (!translations) {
    // Nothing usable from Reversia — fall back to source clone.
    return sourceValue === undefined || sourceValue === null
      ? sourceValue
      : structuredClone(sourceValue);
  }

  // Group translations by their target leaf so we can hand richText/json
  // sub-pointers to applyByKeys, which already knows how to splice them into
  // a Lexical/JSON tree.
  const buckets = bucketTranslationsByLeaf(field, translations);
  let working: unknown =
    sourceValue === undefined || sourceValue === null ? null : structuredClone(sourceValue);

  for (const bucket of buckets) {
    if (bucket.leaf.kind === 'scalar') {
      // One pointer, one value — write each instance at its container pointer.
      for (const [pointer, value] of Object.entries(bucket.entries)) {
        working = writeRaw(working, pointer, value);
      }
      continue;
    }

    // json leaf: locate every leaf instance, apply sub-pointer translations
    // onto it, write the rebuilt subtree back.
    const locations = resolveLeafLocations(working, bucket.leaf.segments);

    for (const { pointer: leafPointer } of locations) {
      const subTranslations: Record<string, string> = {};

      for (const [pointer, value] of Object.entries(bucket.entries)) {
        if (pointerStartsWith(pointer, leafPointer)) {
          const sub = pointer.slice(leafPointer.length);
          subTranslations[sub === '' ? '' : sub] = value;
        }
      }

      if (Object.keys(subTranslations).length === 0) {
        continue;
      }

      const leafSource = readAtPointer(working, leafPointer);

      let rebuilt: unknown;

      if (subTranslations[''] !== undefined && Object.keys(subTranslations).length === 1) {
        // Whole-value json (no translatableKeys): try to JSON.parse round-trip.
        const raw = subTranslations[''];

        try {
          rebuilt = JSON.parse(raw);
        } catch {
          rebuilt = raw;
        }
      } else if (leafSource && typeof leafSource === 'object') {
        rebuilt = applyByKeys(leafSource, subTranslations);
      } else {
        // No source structure — best-effort tree from sub-pointers.
        rebuilt = applyTranslationsToContainer(leafSource, subTranslations);
      }

      working = writeRaw(working, leafPointer, rebuilt);
    }
  }

  return working;
}

interface TranslationBucket {
  leaf: LocalizedLeaf;
  entries: Record<string, string>;
}

function bucketTranslationsByLeaf(
  field: LocalizedFieldInfo,
  translations: Record<string, string>,
): TranslationBucket[] {
  // Order leaves by descending segment length so deeper / more specific leaves
  // claim pointers before broader catch-alls.
  const ordered = [...field.leaves].sort((a, b) => b.segments.length - a.segments.length);
  const remaining = new Map(Object.entries(translations));
  const buckets: TranslationBucket[] = [];

  for (const leaf of ordered) {
    const entries: Record<string, string> = {};
    const leafPath = leafSegmentsAsPointerPrefix(leaf);

    for (const [pointer, value] of remaining) {
      if (leaf.kind === 'scalar') {
        if (matchesScalarLeaf(pointer, leaf)) {
          entries[pointer] = value;
          remaining.delete(pointer);
        }
        continue;
      }

      // json leaf: match by static prefix when possible (key-only segments),
      // or by structural pattern when the leaf is under an iterate/block
      // segment (leafPath is null because we can't build a static prefix —
      // the pointer contains a numeric array index that varies per instance).
      if (leafPath !== null) {
        if (leafPath === '' || pointerStartsWith(pointer, leafPath)) {
          entries[pointer] = value;
          remaining.delete(pointer);
        }
      } else if (matchesJsonLeafPattern(pointer, leaf)) {
        entries[pointer] = value;
        remaining.delete(pointer);
      }
    }

    if (Object.keys(entries).length > 0) {
      buckets.push({ leaf, entries });
    }
  }

  return buckets;
}

/**
 * For json leaves under iterate/iterateBlock segments, check if a pointer
 * structurally matches the leaf's pattern: key segments match literally,
 * iterate/iterateBlock segments match any numeric index, and the pointer
 * may extend deeper (sub-pointers inside the json value).
 */
function matchesJsonLeafPattern(pointer: string, leaf: LocalizedLeaf): boolean {
  if (pointer === '') {
    return leaf.segments.length === 0;
  }

  const parts = pointer.slice(1).split('/');
  let p = 0;

  for (const seg of leaf.segments) {
    if (p >= parts.length) {
      return false;
    }

    if (seg.kind === 'key') {
      if (parts[p] !== seg.name) {
        return false;
      }
      p++;
    } else {
      // iterate / iterateBlock: expect a numeric index
      if (!/^\d+$/.test(parts[p])) {
        return false;
      }
      p++;
    }
  }

  // The pointer matched all leaf segments and may extend deeper into the
  // json value (sub-pointers like /root/children/0/text). That's expected.
  return true;
}

/**
 * For a scalar leaf, the incoming pointer must address exactly the leaf's
 * structural shape: every `key` segment becomes a literal pointer segment;
 * every `iterate` / `iterateBlock` segment matches any one numeric segment.
 */
function matchesScalarLeaf(pointer: string, leaf: LocalizedLeaf): boolean {
  const parts = pointer === '' ? [] : pointer.slice(1).split('/');
  let p = 0;

  for (const seg of leaf.segments) {
    if (p >= parts.length) {
      return false;
    }

    if (seg.kind === 'key') {
      if (parts[p] !== seg.name) {
        return false;
      }
      p++;
      continue;
    }

    if (!/^\d+$/.test(parts[p])) {
      return false;
    }
    p++;
  }

  return p === parts.length;
}

/**
 * Returns the pointer prefix for a json leaf when its location is fully
 * key-only (so we can do a fast `startsWith` match). For leaves under
 * iterate / iterateBlock segments, returns `null` — we fall through to
 * per-instance resolution.
 */
function leafSegmentsAsPointerPrefix(leaf: LocalizedLeaf): string | null {
  const parts: string[] = [];

  for (const seg of leaf.segments) {
    if (seg.kind === 'key') {
      parts.push(seg.name);
      continue;
    }
    return null;
  }

  return parts.length === 0 ? '' : `/${parts.join('/')}`;
}

function pointerStartsWith(pointer: string, prefix: string): boolean {
  if (prefix === '') {
    return true;
  }

  if (!pointer.startsWith(prefix)) {
    return false;
  }

  // Ensure prefix lands on a segment boundary.
  return pointer.length === prefix.length || pointer[prefix.length] === '/';
}

function readAtPointer(target: unknown, pointer: string): unknown {
  if (pointer === '') {
    return target;
  }

  const parts = pointer.slice(1).split('/').map(decodePointerSegment);
  let current: unknown = target;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) {
        return undefined;
      }
      current = current[idx];
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Internal write — like `writeAtPointer` but accepts arbitrary value types
 * (not just strings) and returns the (possibly replaced) root.
 */
function writeRaw(target: unknown, pointer: string, value: unknown): unknown {
  if (pointer === '') {
    return value;
  }

  const parts = pointer.slice(1).split('/').map(decodePointerSegment);

  let root = target;

  if (root === null || root === undefined) {
    root = /^\d+$/.test(parts[0]) ? [] : {};
  }

  let current: unknown = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextKey);

    if (Array.isArray(current)) {
      const idx = Number(key);
      if (current[idx] === null || current[idx] === undefined) {
        current[idx] = nextIsIndex ? [] : {};
      }
      current = current[idx];
      continue;
    }

    if (current && typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (obj[key] === null || obj[key] === undefined) {
        obj[key] = nextIsIndex ? [] : {};
      }
      current = obj[key];
    }
  }

  const last = parts[parts.length - 1];

  if (Array.isArray(current)) {
    current[Number(last)] = value;
  } else if (current && typeof current === 'object') {
    (current as Record<string, unknown>)[last] = value;
  }

  return root;
}

function decodePointerSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

function coerceTranslationMap(raw: unknown): Record<string, string> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
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
        return Object.keys(out).length > 0 ? out : null;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  Source-clone helpers (PrestaShop-style: clone source, overlay translations) */
/* -------------------------------------------------------------------------- */

/**
 * Builds the base `updateData` for a translation insertion by deep-cloning
 * each top-level localized field's value out of the source-locale doc. This
 * guarantees required nested siblings (block structure, ids, non-localized
 * subfields) are present in the update payload, even when Reversia only sent
 * a subset of leaves.
 */
export function cloneLocalizedContainersFromSource(
  sourceDoc: unknown,
  fields: readonly LocalizedFieldInfo[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (!sourceDoc || typeof sourceDoc !== 'object') {
    return out;
  }

  const src = sourceDoc as Record<string, unknown>;

  for (const field of fields) {
    // Only containers need a source-clone base — they carry required nested
    // siblings (array/block ids, blockType, non-localized subfields) that
    // Payload will re-validate on update. Top-level scalars are independent
    // per-locale values: if Reversia hasn't translated one yet, leaving it out
    // of `updateData` preserves whatever the target locale already has.
    // Writing the source-locale scalar into the target locale is actively
    // harmful — any `validate: (value, { locale }) => …` on the field (common
    // on `title`, `slug`, etc.) would see the wrong-language value and reject
    // the update.
    if (!field.isContainer) {
      continue;
    }

    if (!(field.name in src)) {
      continue;
    }

    const value = src[field.name];

    if (value === undefined || value === null) {
      continue;
    }

    out[field.name] = deflatePopulatedRelationships(structuredClone(value));
  }

  return out;
}

/**
 * Payload's Lexical `afterRead` populates relationship / upload fields inside
 * block nodes even when the top-level query uses `depth: 0`. This means a
 * source-locale clone can contain
 *   `media: { id: '...', filename: '...', url: '...' }`
 * where Payload's `update()` expects a plain string ID. On write, Payload's
 * relationship validator sees `[object Object]` and rejects.
 *
 * This utility walks ANY value tree and replaces populated-looking objects
 * (plain objects with a string `id` property at positions where a raw ID is
 * expected — i.e. inside Lexical block node `fields`) with just their `id`.
 * Top-level and non-block objects are left untouched.
 */
export function deflatePopulatedRelationships(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(deflatePopulatedRelationships);
  }

  const obj = value as Record<string, unknown>;

  // Lexical block node — deflate populated fields inside `fields`.
  if (obj.type === 'block' && obj.fields && typeof obj.fields === 'object') {
    const fields = obj.fields as Record<string, unknown>;
    const deflated: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(fields)) {
      if (key === 'id' || key === 'blockType' || key === 'blockName') {
        deflated[key] = val;
      } else {
        deflated[key] = deflateValue(val);
      }
    }

    return {
      ...obj,
      fields: deflated,
      ...(Array.isArray(obj.children)
        ? { children: obj.children.map(deflatePopulatedRelationships) }
        : {}),
    };
  }

  // Any other object — recurse all keys, deflating populated docs wherever
  // they appear. This catches relationship / upload fields inside Payload
  // array items, group subfields, etc. — not just Lexical blocks.
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    out[k] = deflateValue(v);
  }

  return out;
}

/**
 * Deflate a single value: if it's a populated doc, return its id. If it's a
 * polymorphic relationship `{ relationTo, value: <populated> }`, deflate the
 * inner value. Otherwise recurse.
 */
function deflateValue(val: unknown): unknown {
  if (val === null || val === undefined || typeof val !== 'object') {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map(deflateValue);
  }

  // Direct populated doc → raw id  (e.g. upload field: { id, filename, ... })
  if (isPopulatedDoc(val)) {
    return (val as Record<string, unknown>).id;
  }

  // Polymorphic relationship: { relationTo: 'x', value: <populated> }
  const obj = val as Record<string, unknown>;

  if (typeof obj.relationTo === 'string' && 'value' in obj && isPopulatedDoc(obj.value)) {
    return { relationTo: obj.relationTo, value: (obj.value as Record<string, unknown>).id };
  }

  // hasMany polymorphic: { relationTo: 'x', value: [<populated>, ...] }
  if (typeof obj.relationTo === 'string' && Array.isArray(obj.value)) {
    return {
      relationTo: obj.relationTo,
      value: obj.value.map((item: unknown) =>
        isPopulatedDoc(item) ? (item as Record<string, unknown>).id : item,
      ),
    };
  }

  // Recurse into nested structure
  return deflatePopulatedRelationships(val);
}

function isPopulatedDoc(val: unknown): boolean {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    return false;
  }

  const obj = val as Record<string, unknown>;

  return (
    typeof obj.id === 'string' &&
    ('createdAt' in obj || 'updatedAt' in obj || 'filename' in obj || 'mimeType' in obj)
  );
}
