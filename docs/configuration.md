# Configuration

## Registering the plugin

```ts
import { buildConfig } from 'payload';
import { reversiaPlugin } from 'payload-plugin-reversia';

export default buildConfig({
  plugins: [
    reversiaPlugin({
      apiKey: process.env.REVERSIA_API_KEY!,
      enabledCollections: ['posts', 'pages'],
      enabledGlobals: ['site-settings'],
    }),
  ],
});
```

## Options

| Option               | Type                | Required | Default | Description                                                            |
| -------------------- | ------------------- | -------- | ------- | ---------------------------------------------------------------------- |
| `apiKey`             | `string`            | yes      | —       | Shared secret validated against the `X-API-Key` header on every call.  |
| `enabledCollections` | `CollectionSlug[]`  | no       | all     | Whitelist of collections exposed to Reversia.                          |
| `enabledGlobals`     | `string[]`          | no       | all     | Whitelist of globals exposed to Reversia.                              |
| `disabled`           | `boolean`           | no       | `false` | Skip the plugin entirely. Useful for test environments.                |

When a whitelist is omitted, every collection or global that declares at least one `localized: true` field is exposed.

## API key

Set the key in your environment:

```bash
REVERSIA_API_KEY=sk_live_xxxxxxxxxxxxxxxx
```

Each request from the Reversia SaaS must include it:

- Header: `X-API-Key: <key>`
- or query param: `?apiKey=<key>` (for GETs, convenient for debugging)

Unauthenticated requests return `401`.

## What gets exposed

A collection or global is exposed only when `findLocalizedFields` finds at least one field with `localized: true`. Nested fields inside `group`, `tabs`, `blocks`, and `array` are walked. Fields added via the plugin's hidden sync queue (`reversia-sync-pending`) are internal and never exposed.

## Hooks

The plugin installs an `afterChange` hook on every exposed collection to record changes in the sync queue. The hook is a no-op when the mutation came from Reversia itself (the insertion endpoint passes `context.reversiaInsertion = true`).
