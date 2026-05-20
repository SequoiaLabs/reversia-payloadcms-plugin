import type { CollectionSlug, GlobalSlug } from 'payload';

const DEFAULT_BASE_URL = 'https://staging.api.reversia.tech';
const TYPE_NAMESPACE = 'payloadcms:';
const TRIGGER_CRAWL_PATH = '/projects/trigger-crawl';

export interface TriggerCrawlOptions {
  /** Reversia project API key (the same value passed to `reversiaPlugin({ apiKey })`). */
  apiKey: string;
  /**
   * Collection and/or global slugs to crawl. Each slug is prefixed with
   * `payloadcms:` before being sent to Reversia. Omit/empty → crawl all
   * enabled resources for the project.
   */
  types?: Array<CollectionSlug | GlobalSlug>;
  /** Bypass cached crawl content. Defaults to `false`. */
  noCache?: boolean;
  /**
   * Override the Reversia API base URL. Defaults to `process.env.REVERSIA_API_URL`
   * then a built-in production/staging URL.
   */
  baseUrl?: string;
  /** Optional custom fetch (for tests / proxies). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface TriggerCrawlResult {
  success: boolean;
}

export async function triggerCrawl(options: TriggerCrawlOptions): Promise<TriggerCrawlResult> {
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
    throw new Error(
      '[reversia] apiKey is required. Pass `TriggerCrawlOptions.apiKey` as a non-empty string.',
    );
  }

  const baseUrl = (options.baseUrl ?? process.env.REVERSIA_API_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  );

  const normalizedTypes = (options.types ?? [])
    .filter((t): t is CollectionSlug | GlobalSlug => typeof t === 'string' && t.length > 0)
    .map((t) => `${TYPE_NAMESPACE}${t}`);

  const body: Record<string, unknown> = {};

  if (normalizedTypes.length > 0) {
    body.types = normalizedTypes;
  }

  if (options.noCache) {
    body.noCache = true;
  }

  const fetchImpl = options.fetch ?? fetch;

  const response = await fetchImpl(`${baseUrl}${TRIGGER_CRAWL_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let excerpt = '';

    try {
      excerpt = (await response.text()).slice(0, 200);
    } catch {
      // ignore body read errors — keep the status info
    }

    throw new Error(
      `[reversia] trigger-crawl failed: ${response.status} ${response.statusText}${
        excerpt ? ` — ${excerpt}` : ''
      }`,
    );
  }

  let parsed: { success?: unknown } | null = null;

  try {
    parsed = (await response.json()) as { success?: unknown };
  } catch {
    parsed = null;
  }

  return { success: parsed?.success !== false };
}
