# Configuration

## Registering the plugin

```ts
import { buildConfig } from 'payload';
import { reversiaPlugin } from '@sequoialabs/payload-plugin-reversia';

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

- Header: `X-API-Key: <key>` (preferred)
- or query param: `?apiKey=<key>` (for GETs, convenient for debugging — but it ends up in access logs)

Unauthenticated requests return `401`. Validation is constant-time (`crypto.timingSafeEqual`). The plugin refuses to start if `apiKey` is missing or empty — it will not silently run unauthenticated.

## What gets exposed

A collection or global is exposed only when `findLocalizedFields` finds at least one localized leaf. Each top-level field that contains any localized descendant produces one resource entry — scalars ship as primitives, containers (group / array / blocks / richText / json) ship as a JSON-pointer map of the localized atoms inside (see [Rich text & JSON fields](./rich-text.md)). Non-localized siblings, structural keys, and unrelated subfields are filtered out before reaching Reversia. The hidden sync queue (`reversia-sync-pending`) is internal and never exposed.

## Hooks

The plugin installs an `afterChange` hook on every exposed collection to record changes in the sync queue. The hook is a no-op when the mutation came from Reversia itself (the insertion endpoint passes `context.reversiaInsertion = true`).
