import type { CollectionSlug } from 'payload';
import type { LeafSegment } from './utils/path-resolver.js';

export interface ReversiaPluginConfig {
  /**
   * API key used by Reversia SaaS to authenticate requests.
   * Validated against `X-API-Key` header.
   */
  apiKey: string;

  /**
   * Optional: restrict which collections are exposed to Reversia.
   * If omitted, all collections with localized fields are exposed.
   */
  enabledCollections?: CollectionSlug[];

  /**
   * Optional: restrict which globals are exposed to Reversia.
   * If omitted, all globals with localized fields are exposed.
   */
  enabledGlobals?: string[];

  /**
   * Whether the plugin is disabled. Defaults to false.
   */
  disabled?: boolean;
}

export enum ReversiaFieldType {
  TEXT = 'TEXT',
  HTML = 'HTML',
  JSON = 'JSON',
  LINK = 'LINK',
  MEDIUM = 'MEDIUM',
}

export enum ReversiaFieldBehavior {
  SLUG = 'slug',
}

/**
 * Custom field metadata for Reversia.
 *
 * Usage on any PayloadCMS field:
 * ```ts
 * import { ReversiaFieldType, ReversiaFieldBehavior } from 'payload-plugin-reversia'
 *
 * {
 *   name: 'slug',
 *   type: 'text',
 *   localized: true,
 *   custom: {
 *     reversia: {
 *       behavior: ReversiaFieldBehavior.SLUG,
 *     },
 *   },
 * }
 *
 * {
 *   name: 'ogImage',
 *   type: 'text',
 *   localized: true,
 *   custom: {
 *     reversia: {
 *       type: ReversiaFieldType.MEDIUM,
 *     },
 *   },
 * }
 * ```
 */
export interface ReversiaFieldCustom {
  /**
   * How the field value should be treated during translation.
   */
  behavior?: ReversiaFieldBehavior;

  /**
   * The content type of the field value.
   * Inferred from PayloadCMS field type when omitted (richText → JSON, json → JSON).
   * The Lexical/Slate tree is shipped as a JSON-encoded map of translatable leaves.
   */
  type?: ReversiaFieldType;

  /**
   * Whether this field is used as the resource label in Reversia.
   */
  asLabel?: boolean;

  /**
   * Whether this field is selected for translation by default.
   * Defaults to true.
   */
  selected?: boolean;

  /**
   * For object/array-shaped values (richText, json), restrict which leaf strings
   * are shipped to Reversia.
   *
   * Path syntax:
   * - `text`                  — any key `text` at any depth (shorthand for `**.text`)
   * - `root.foo`              — exact path from the root
   * - `foo.*.bar`             — single wildcard segment (one object key or array index)
   * - `foo.**.bar`            — deep wildcard (zero or more segments)
   *
   * Default for `richText` when omitted: `['text', 'url', 'alt']`.
   * For `json`, extraction only happens when this is explicitly set (or `extract` is provided).
   */
  translatableKeys?: string[];

  /**
   * Escape hatch. When provided, bypasses `translatableKeys` matching entirely.
   * `extract` receives the raw field value and returns the string shipped to Reversia.
   * `apply` receives the source-locale value plus the translated string and returns
   * the value stored on the target locale. Both must be set together.
   */
  extract?: (value: unknown) => string;
  apply?: (sourceValue: unknown, translated: string) => unknown;
}

export interface TranslatableFieldConfig {
  label: string;
  asLabel?: boolean;
  behavior?: ReversiaFieldBehavior;
  type?: ReversiaFieldType;
  selected?: boolean;
  rules?: {
    maxLength?: number;
    minLength?: number;
  };
}

export interface ResourceDefinition {
  type: string;
  label: {
    singular: string;
    plural: string;
  };
  group: string;
  version: string;
  configuration: Record<string, TranslatableFieldConfig>;
  configurationType: 'ENTITY' | 'MULTIPLE';
  count?: number;
  synchronizable: boolean;
}

/**
 * Describes one localized leaf inside a top-level container field.
 *
 * `segments` walks from the container's *value* to the leaf (so a top-level
 * scalar localized field has `segments: []` because the container value IS
 * the scalar).
 *
 * `kind`:
 *  - `scalar` — atomic string-shaped leaf (text, textarea, email, url, …)
 *    serialized as-is at its pointer.
 *  - `json` — structurally complex leaf (richText, json) that needs internal
 *    extraction by `translatableKeys`. Each matching sub-leaf gets its own
 *    pointer entry, prefixed by the leaf's own pointer in the container.
 */
export interface LocalizedLeaf {
  segments: LeafSegment[];
  kind: 'scalar' | 'json';
  payloadFieldType: string;
  reversia?: ReversiaFieldCustom;
}

/**
 * One translatable top-level field on a collection or global.
 *
 * The plugin emits exactly one resource-content entry per `LocalizedFieldInfo`,
 * keyed by `name`. Scalars ship their value directly. Containers ship a
 * JSON-stringified `{ <jsonPointer>: <translatableString> }` map whose keys
 * address each atomic translatable leaf inside the container's value.
 */
export interface LocalizedFieldInfo {
  /** Top-level field name — the key in the document and in the content map. */
  name: string;
  /** Resolved label for the resource configuration. */
  label: string;
  /** PayloadCMS field type at the top level (`text`, `richText`, `array`, …). */
  payloadFieldType: string;
  /**
   * `true` when the value is shipped as a JSON pointer-map (containers).
   * `false` when shipped as a plain primitive (top-level localized scalars).
   */
  isContainer: boolean;
  /** `custom.reversia` declared on the top-level field, if any. */
  reversia?: ReversiaFieldCustom;
  /** One descriptor per localized leaf inside the container. */
  leaves: LocalizedLeaf[];
  /** Payload `maxLength` on the field (text / textarea / code). */
  maxLength?: number;
  /** Payload `minLength` on the field (text / textarea / code). */
  minLength?: number;
  /**
   * True when Payload marks this field (or any required inner leaf) as
   * `required`. Used during insertion to seed empty target-locale slots from
   * the source locale so Payload's whole-document validation doesn't reject
   * the update.
   */
  hasRequiredLeaf?: boolean;
}

export interface ResourceItem {
  id: string;
  label?: string;
  content: Record<string, unknown>;
  contentTypes?: Record<string, string>;
}

export interface StreamResponse {
  content: Array<{
    type: string;
    data: ResourceItem[];
  }>;
  cursor: string | null;
}

export interface InsertionRequest {
  type: string;
  id: string;
  sourceLocale: string;
  targetLocale: string;
  data: Record<string, unknown>;
}

export interface InsertionResponse {
  errors: string[];
  [key: number]: {
    index: number;
    type: string;
    id: string;
    diff: Record<string, string>;
  };
}

export interface Cursor {
  type: string;
  id: string;
}

/**
 * Response shape for `GET /reversia/resource` (single collection doc or global).
 */
export interface ResourceResponse {
  id: string;
  label?: string;
  content: Record<string, unknown>;
  contentTypes?: Record<string, string>;
}

/**
 * Response shape for `GET /reversia/settings`.
 */
export interface SettingsResponse {
  platform: 'payloadcms';
  pluginVersion: string;
  languages: Array<{ code: string; label: string }>;
  defaultLocale: string;
}

/**
 * Response shape for `POST /reversia/confirm-resources-sync`.
 */
export interface ConfirmResourcesSyncResponse {
  success: true;
  deleted: number;
}

/**
 * 4xx/5xx error response used uniformly across endpoints.
 */
export interface ReversiaErrorResponse {
  error: string;
}
