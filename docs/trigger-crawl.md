# Triggering crawls

The plugin exposes two ways to trigger a Reversia crawl from your PayloadCMS app.

| Use case | API |
|---|---|
| Server-side (cron, scripts, custom endpoints, Payload hooks) | `triggerCrawl(...)` |
| Admin UI (custom dashboard components, views) | `useTriggerCrawl()` hook |

Both ultimately call Reversia's `POST /projects/trigger-crawl` endpoint. The hook routes through a session-authenticated server endpoint shipped by the plugin so the API key never leaves the server.

## `triggerCrawl(...)` — server-side

```ts
import { triggerCrawl } from '@sequoialabs/payload-plugin-reversia';

await triggerCrawl({
  apiKey: process.env.REVERSIA_API_KEY!,
  types: ['articles', 'site-settings'], // optional
  noCache: true,                         // optional
  baseUrl: 'https://api.reversia.tech',  // optional
});
```

### Options

| Field | Type | Description |
|---|---|---|
| `apiKey` | `string` (required) | The project's Reversia API key. |
| `types` | `Array<CollectionSlug \| GlobalSlug>` | Collection or global slugs. Auto-prefixed with `payloadcms:`. Omit/empty to crawl every enabled resource. |
| `noCache` | `boolean` | Bypass cached crawl content. Defaults to `false`. |
| `baseUrl` | `string` | Override the Reversia API base URL. Defaults to `process.env.REVERSIA_API_URL`, then the built-in production URL. |
| `fetch` | `typeof fetch` | Inject a custom fetch (tests, proxies). |

Returns `Promise<{ success: boolean }>`. Throws on non-2xx HTTP responses with a `[reversia] trigger-crawl failed:` prefix.

### Example — Payload `afterChange` hook

```ts
import type { CollectionAfterChangeHook } from 'payload';
import { triggerCrawl } from '@sequoialabs/payload-plugin-reversia';

export const onArticleChange: CollectionAfterChangeHook = async ({ req }) => {
  await triggerCrawl({
    apiKey: process.env.REVERSIA_API_KEY!,
    types: ['articles'],
  }).catch((err) => req.payload.logger.error({ msg: 'crawl trigger failed', err }));
};
```

## `useTriggerCrawl()` — client-side

A React hook for custom admin components (e.g. `beforeDashboard`, custom views). It POSTs to a server endpoint shipped by the plugin (`/api/reversia/dashboard/trigger-crawl`) that authenticates with the current Payload user session — so the API key stays server-side.

```tsx
'use client';

import { useTriggerCrawl } from '@sequoialabs/payload-plugin-reversia/client';

export function CrawlPanel() {
  const { trigger, status, error } = useTriggerCrawl();

  return (
    <div>
      <button
        type="button"
        onClick={() => trigger({ types: ['articles'] })}
        disabled={status === 'pending'}
      >
        {status === 'pending' ? 'Triggering…' : 'Trigger crawl'}
      </button>
      {status === 'success' && <p>Crawl triggered.</p>}
      {status === 'error' && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
```

### Returned API

| Field | Type | Description |
|---|---|---|
| `trigger` | `(args?: TriggerCrawlArgs) => Promise<TriggerCrawlOutcome>` | Fires a crawl. Updates state and resolves with `{ success, error? }`. |
| `status` | `'idle' \| 'pending' \| 'success' \| 'error'` | Current request state. |
| `error` | `string \| null` | Error message when `status === 'error'`. |
| `reset` | `() => void` | Reset `status` to `'idle'` and clear `error`. |

### Hook options

| Field | Type | Description |
|---|---|---|
| `endpoint` | `string` | Override the server route. Defaults to `/api/reversia/dashboard/trigger-crawl`. |

### `trigger(args)` arguments

| Field | Type | Description |
|---|---|---|
| `types` | `Array<CollectionSlug \| GlobalSlug>` | Slugs to crawl. Same semantics as the server function. |
| `noCache` | `boolean` | Bypass cached crawl content. |

### Wiring into the admin dashboard

```ts
// src/components/CrawlPanel.tsx — your component using the hook (see snippet above)

// payload.config.ts
buildConfig({
  admin: {
    components: {
      beforeDashboard: ['@/components/CrawlPanel'],
    },
  },
  plugins: [reversiaPlugin({ apiKey: process.env.REVERSIA_API_KEY! })],
});
```

Then run `payload generate:importmap` so Payload picks up the new component path.

## Server endpoint reference

The hook calls `POST /api/reversia/dashboard/trigger-crawl`:

- **Auth:** any authenticated Payload user (session cookie via `credentials: 'same-origin'`).
- **Body:** `{ types?: string[]; noCache?: boolean }` — same shape as the public `triggerCrawl` options.
- **Response:** `{ success: true }` on success, `{ error: string }` with status `401` (no session) or `502` (Reversia call failed).

You can call this endpoint directly from any logged-in admin context — the hook is just the typed wrapper.
