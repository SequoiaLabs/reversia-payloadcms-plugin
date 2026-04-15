import type { PayloadRequest } from 'payload';

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
