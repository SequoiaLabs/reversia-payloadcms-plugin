import type { Field } from 'payload'
import type { LocalizedFieldInfo, ReversiaFieldCustom, TranslatableFieldConfig } from '../types.js'
import { ReversiaFieldType, ReversiaFieldBehavior } from '../types.js'
import { resolveStaticLabel } from './labels.js'

function getFieldLabel(field: Field): string {
  if (!('name' in field)) {
    return ''
  }

  const name = 'name' in field ? String(field.name ?? '') : ''

  if ('label' in field) {
    return resolveStaticLabel(field.label, name)
  }

  return name
}

function getReversiaCustom(field: Field): ReversiaFieldCustom | undefined {
  if ('custom' in field && field.custom && typeof field.custom === 'object') {
    const custom = field.custom as Record<string, unknown>

    if (custom.reversia && typeof custom.reversia === 'object') {
      return custom.reversia as ReversiaFieldCustom
    }
  }

  return undefined
}

function hasSubFields(field: Field): field is Field & { fields: Field[] } {
  return 'fields' in field && Array.isArray((field as Record<string, unknown>).fields)
}

function isTabsField(field: Field): field is Field & { tabs: Array<{ fields: Field[]; label?: string }> } {
  return field.type === 'tabs' && 'tabs' in field
}

function isBlocksField(field: Field): field is Field & { blocks: Array<{ slug: string; fields: Field[] }> } {
  return field.type === 'blocks' && 'blocks' in field
}

export function findLocalizedFields(
  fields: Field[],
  parentPath: string = '',
): LocalizedFieldInfo[] {
  const result: LocalizedFieldInfo[] = []

  for (const field of fields) {
    if (!('name' in field) || !field.name) {
      if (isTabsField(field)) {
        for (const tab of field.tabs) {
          result.push(...findLocalizedFields(tab.fields, parentPath))
        }
      }
      if (hasSubFields(field)) {
        result.push(...findLocalizedFields(field.fields, parentPath))
      }
      continue
    }

    const fieldPath = parentPath ? `${parentPath}.${field.name}` : field.name
    const isLocalized = 'localized' in field && (field as Record<string, unknown>).localized === true

    if (isLocalized) {
      result.push({
        name: field.name,
        path: fieldPath,
        label: getFieldLabel(field),
        type: field.type,
        payloadFieldType: field.type,
        isNested: !!parentPath,
        reversia: getReversiaCustom(field),
      })
    }

    if (hasSubFields(field)) {
      result.push(...findLocalizedFields(field.fields, fieldPath))
    }

    if (isBlocksField(field)) {
      for (const block of field.blocks) {
        result.push(...findLocalizedFields(block.fields, `${fieldPath}.${block.slug}`))
      }
    }
  }

  return result
}

/**
 * Resolves the Reversia content type for a field.
 *
 * Priority:
 * 1. Explicit `custom.reversia.type` annotation
 * 2. Inferred from PayloadCMS field type (richText → HTML, json → JSON)
 * 3. undefined (plain text, no annotation needed)
 */
export function resolveContentType(field: LocalizedFieldInfo): ReversiaFieldType | undefined {
  if (field.reversia?.type) {
    return field.reversia.type
  }

  if (field.payloadFieldType === 'richText') {
    return ReversiaFieldType.JSON
  }

  if (field.payloadFieldType === 'json') {
    return ReversiaFieldType.JSON
  }

  return undefined
}

/**
 * Resolves the Reversia behavior for a field.
 *
 * Priority:
 * 1. Explicit `custom.reversia.behavior` annotation
 * 2. undefined (no special behavior)
 */
function resolveBehavior(field: LocalizedFieldInfo): ReversiaFieldBehavior | undefined {
  return field.reversia?.behavior
}

/**
 * Resolves whether the field should be used as the resource label.
 *
 * Priority:
 * 1. Explicit `custom.reversia.asLabel` annotation
 * 2. Field named 'title' or 'name' (first match)
 */
function resolveAsLabel(field: LocalizedFieldInfo, hasLabelAlready: boolean): boolean {
  if (field.reversia?.asLabel !== undefined) {
    return field.reversia.asLabel
  }

  if (!hasLabelAlready && (field.name === 'title' || field.name === 'name')) {
    return true
  }

  return false
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildNestedLabel(field: LocalizedFieldInfo): string {
  const fieldLabel = field.label || field.name
  const segments = field.path.split('.')

  if (segments.length <= 1) {
    return fieldLabel
  }

  // Build context from parent path segments, skip the last one (the field itself)
  const parentSegments = segments.slice(0, -1).map(capitalize)
  return `${parentSegments.join(' > ')} > ${fieldLabel}`
}

export function buildTranslatableConfiguration(
  localizedFields: LocalizedFieldInfo[],
): Record<string, TranslatableFieldConfig> {
  const config: Record<string, TranslatableFieldConfig> = {}
  let hasLabelField = false

  for (const field of localizedFields) {
    const fieldConfig: TranslatableFieldConfig = {
      label: field.isNested ? buildNestedLabel(field) : (field.label || field.name),
    }

    const isLabel = resolveAsLabel(field, hasLabelField)

    if (isLabel) {
      fieldConfig.asLabel = true
      hasLabelField = true
    }

    const contentType = resolveContentType(field)

    if (contentType) {
      fieldConfig.type = contentType
    }

    const behavior = resolveBehavior(field)

    if (behavior) {
      fieldConfig.behavior = behavior
    }

    if (field.reversia?.selected === false) {
      fieldConfig.selected = false
    }

    config[field.path] = fieldConfig
  }

  return config
}

// Re-export for backwards compat with endpoints that use this
export const getContentType = resolveContentType
