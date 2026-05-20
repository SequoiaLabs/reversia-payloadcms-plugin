'use client';

import type { CollectionSlug, GlobalSlug } from 'payload';
import { useCallback, useState } from 'react';

export type TriggerCrawlStatus = 'idle' | 'pending' | 'success' | 'error';

export interface UseTriggerCrawlOptions {
  /**
   * Override the server endpoint path. Defaults to
   * `/api/reversia/dashboard/trigger-crawl`.
   */
  endpoint?: string;
}

export interface TriggerCrawlArgs {
  /**
   * Collection and/or global slugs to crawl. Slugs are prefixed with
   * `payloadcms:` server-side before reaching Reversia. Omit/empty to crawl
   * every enabled resource for the project.
   */
  types?: Array<CollectionSlug | GlobalSlug>;
  /** Bypass cached crawl content. Defaults to `false`. */
  noCache?: boolean;
}

export interface TriggerCrawlOutcome {
  success: boolean;
  error?: string;
}

export interface UseTriggerCrawlResult {
  trigger: (args?: TriggerCrawlArgs) => Promise<TriggerCrawlOutcome>;
  status: TriggerCrawlStatus;
  error: string | null;
  reset: () => void;
}

const DEFAULT_ENDPOINT = '/api/reversia/dashboard/trigger-crawl';

export function useTriggerCrawl(options: UseTriggerCrawlOptions = {}): UseTriggerCrawlResult {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const [status, setStatus] = useState<TriggerCrawlStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const trigger = useCallback(
    async (args: TriggerCrawlArgs = {}): Promise<TriggerCrawlOutcome> => {
      setStatus('pending');
      setError(null);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            ...(args.types && args.types.length > 0 ? { types: args.types } : {}),
            ...(args.noCache ? { noCache: true } : {}),
          }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };

        if (!response.ok || body.success === false) {
          const message = body.error ?? `Request failed (${response.status})`;

          setStatus('error');
          setError(message);

          return { success: false, error: message };
        }

        setStatus('success');
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        setStatus('error');
        setError(message);

        return { success: false, error: message };
      }
    },
    [endpoint],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { trigger, status, error, reset };
}
