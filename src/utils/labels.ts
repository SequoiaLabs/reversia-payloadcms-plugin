/**
 * Resolves a PayloadCMS static label to a plain string.
 *
 * Labels in Payload can be:
 * - `string`: "Post"
 * - `Record<string, string>`: { en: "Post", fr: "Article" }
 * - `function`: (args) => string (used for dynamic labels in admin UI)
 * - `false` | `undefined`
 *
 * We pick the first available value: `en` key, then first key, then fallback.
 */
export function resolveStaticLabel(label: unknown, fallback: string): string {
  if (typeof label === 'string') {
    return label;
  }

  if (label && typeof label === 'object' && !Array.isArray(label)) {
    const record = label as Record<string, string>;

    if (typeof record.en === 'string') {
      return record.en;
    }

    const firstKey = Object.keys(record)[0];

    if (firstKey && typeof record[firstKey] === 'string') {
      return record[firstKey];
    }
  }

  return fallback;
}
