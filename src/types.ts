import type { CollectionSlug, Field } from 'payload'

export interface ReversiaPluginConfig {
  /**
   * API key used by Reversia SaaS to authenticate requests.
   * Validated against `X-API-Key` header.
   */
  apiKey: string

  /**
   * Optional: restrict which collections are exposed to Reversia.
   * If omitted, all collections with localized fields are exposed.
   */
  enabledCollections?: CollectionSlug[]

  /**
   * Optional: restrict which globals are exposed to Reversia.
   * If omitted, all globals with localized fields are exposed.
   */
  enabledGlobals?: string[]

  /**
   * Whether the plugin is disabled. Defaults to false.
   */
  disabled?: boolean
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
  behavior?: ReversiaFieldBehavior

  /**
   * The content type of the field value.
   * Inferred from PayloadCMS field type when omitted (richText → HTML, json → JSON).
   */
  type?: ReversiaFieldType

  /**
   * Whether this field is used as the resource label in Reversia.
   */
  asLabel?: boolean

  /**
   * Whether this field is selected for translation by default.
   * Defaults to true.
   */
  selected?: boolean
}

export interface TranslatableFieldConfig {
  label: string
  asLabel?: boolean
  behavior?: ReversiaFieldBehavior
  type?: ReversiaFieldType
  selected?: boolean
}

export interface ResourceDefinition {
  type: string
  label: {
    singular: string
    plural: string
  }
  group: string
  version: string
  configuration: Record<string, TranslatableFieldConfig>
  configurationType: 'ENTITY' | 'MULTIPLE'
  count?: number
  synchronizable: boolean
}

export interface LocalizedFieldInfo {
  name: string
  path: string
  label: string
  type: string
  payloadFieldType: string
  isNested: boolean
  reversia?: ReversiaFieldCustom
}

export interface ResourceItem {
  id: string
  label?: string
  content: Record<string, unknown>
  contentTypes?: Record<string, string>
}

export interface StreamResponse {
  content: Array<{
    type: string
    data: ResourceItem[]
  }>
  cursor: string | null
}

export interface InsertionRequest {
  type: string
  id: string
  sourceLocale: string
  targetLocale: string
  data: Record<string, unknown>
}

export interface InsertionResponse {
  errors: string[]
  [key: number]: {
    index: number
    type: string
    id: string
    diff: Record<string, unknown>
  }
}

export interface Cursor {
  type: string
  id: string
}
