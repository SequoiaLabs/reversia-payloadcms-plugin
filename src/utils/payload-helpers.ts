import type { CollectionConfig, GlobalConfig, PayloadRequest } from 'payload';
import type { EnabledResource, ReversiaPluginConfig } from '../types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/**
 * Parses a caller-supplied `limit` query parameter and clamps it to a safe
 * range. NaN, zero, and negatives fall back to the default.
 */
export function parseLimit(raw: string | null, fallback: number = DEFAULT_LIMIT): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Resolves the default locale code from a Payload config, defaulting to `en`
 * when localization is not configured.
 */
export function resolveDefaultLocale(req: PayloadRequest): string {
  const localization = req.payload.config.localization;

  if (localization && typeof localization === 'object' && 'defaultLocale' in localization) {
    const value = (localization as { defaultLocale: unknown }).defaultLocale;

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return 'en';
}

/**
 * True when a collection or global enables `versions.drafts`. Accepts both
 * the raw config shape (`versions: { drafts: true }`) and Payload's sanitized
 * one (`versions: { drafts: { autosave: false, … } }`).
 */
export function hasDraftsEnabled(entity: CollectionConfig | GlobalConfig): boolean {
  const versions = entity.versions;

  return Boolean(versions && typeof versions === 'object' && versions.drafts);
}

/**
 * Slug of an `enabledCollections` / `enabledGlobals` entry, whichever form
 * it was written in.
 */
export function resourceSlug(entry: EnabledResource): string {
  return typeof entry === 'string' ? entry : entry.slug;
}

/**
 * Resolves the configured `useDrafts` value for one resource: the
 * per-resource override from its `enabledCollections` / `enabledGlobals`
 * entry when present, otherwise the root `useDrafts` flag (default false).
 */
export function resolveUseDrafts(
  pluginConfig: ReversiaPluginConfig,
  kind: 'collection' | 'global',
  slug: string,
): boolean {
  const entries =
    kind === 'collection' ? pluginConfig.enabledCollections : pluginConfig.enabledGlobals;
  const entry = entries?.find((e) => resourceSlug(e) === slug);

  if (entry && typeof entry !== 'string' && typeof entry.useDrafts === 'boolean') {
    return entry.useDrafts;
  }

  return pluginConfig.useDrafts === true;
}

/**
 * Whether reads and writes for `entity` should target its draft rather than
 * the published document: requires both `useDrafts` resolving to true for
 * this resource and `versions.drafts` on the entity.
 */
export function shouldUseDrafts(
  pluginConfig: ReversiaPluginConfig,
  kind: 'collection' | 'global',
  entity: CollectionConfig | GlobalConfig,
): boolean {
  return resolveUseDrafts(pluginConfig, kind, entity.slug) && hasDraftsEnabled(entity);
}

/**
 * Plain dot-path lookup on an object, returning `undefined` for any missing
 * segment or non-object traversal. Does not walk into arrays.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
