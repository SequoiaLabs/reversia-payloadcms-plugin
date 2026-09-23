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
| `enabledCollections` | `(CollectionSlug \| { slug, useDrafts? })[]` | no | all | Whitelist of collections exposed to Reversia. Object entries can override `useDrafts` per collection. |
| `enabledGlobals`     | `(string \| { slug, useDrafts? })[]`         | no | all | Whitelist of globals exposed to Reversia. Object entries can override `useDrafts` per global. |
| `disabled`           | `boolean`           | no       | `false` | Skip the plugin entirely. Useful for test environments.                |
| `baseUrl`            | `string`            | no       | env     | Reversia API base URL for `triggerCrawl`. See [Trigger crawl](./trigger-crawl.md). |
| `useDrafts`          | `boolean`           | no       | `false` | Root default: read from and write to drafts on entities with `versions.drafts`. See [Drafts](#drafts). |

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

## Drafts

By default the plugin ignores Payload's draft system: reads return the published document and insertions publish immediately. On a collection or global with `versions.drafts` enabled that has a side effect — Payload bases every non-draft update on the **latest** version, so inserting a translation also publishes whatever unpublished edits the source locale had at that moment.

Set `useDrafts: true` to make the plugin draft-aware:

```ts
reversiaPlugin({
  apiKey: process.env.REVERSIA_API_KEY!,
  useDrafts: true,
});
```

For every collection and global that enables `versions.drafts`:

- `GET /reversia/resources` and `GET /reversia/resource` return the latest draft when one is newer than the published document, otherwise the published document. Reversia therefore translates what editors are currently working on.
- `PUT /reversia/resources-insert` reads the source locale from that same draft and saves the translation with `draft: true`. The published document is never touched. Editing the source locale afterwards keeps the inserted translation in the draft, and the `diff` in the insertion response is computed against the draft's previous target-locale value.
- Publishing remains an editorial action in Payload. A normal publish (`_status: 'published'` without `publishSpecificLocale`) publishes the whole document, so every inserted translation goes live together with the source locale. Publishing with `publishSpecificLocale` publishes only that locale and leaves the other locales' translations in the draft.

### Per-resource control

The root flag is a default. Any entry in `enabledCollections` or `enabledGlobals` can be written as `{ slug, useDrafts }` to override it for that resource:

```ts
reversiaPlugin({
  apiKey: process.env.REVERSIA_API_KEY!,
  useDrafts: true,
  enabledCollections: [
    'posts',                               // inherits root: drafts
    { slug: 'pages', useDrafts: false },   // always published
  ],
  enabledGlobals: [{ slug: 'site-settings', useDrafts: true }],
});
```

Entities without `versions.drafts` behave exactly as before, whatever the flag. Draft saves still fire `afterChange`, so editors' draft edits land in the sync queue and Reversia re-translates them; insertions never enqueue anything.

## Active / inactive documents

A collection or global can declare which of its documents are "good for translation". Reversia then treats the resource as **deactivable**, the same way it treats disabled PrestaShop products or categories. Inactive documents are still crawled, but Reversia does not translate them unless the project enables "translate deactivated data" for that resource.

Declare an `isActive` function under `custom.reversia` on the collection or global config:

```ts
export const Products: CollectionConfig = {
  slug: 'products',
  custom: {
    reversia: {
      isActive: ({ doc }) => doc._status === 'published' && !doc.archived,
    },
  },
  fields: [/* … */],
};
```

The function receives `{ doc, req, slug, kind }` and returns a boolean, or a promise of one. `doc` is the document as the plugin reads it: default locale, and the latest draft when [`useDrafts`](#drafts) applies. `kind` is `'collection'` or `'global'`.

The plugin augments Payload's `CollectionCustom`, `GlobalCustom` and `FieldCustom` types, so `custom.reversia` is type-checked without any annotation. A misspelled key, a non-function `isActive` or a non-boolean return fails to compile. By default `doc` is a plain JSON object. Annotate the argument with your generated type to narrow it:

```ts
import type { ReversiaIsActiveArgs } from '@sequoialabs/payload-plugin-reversia';
import type { Product } from '../payload-types';

isActive: ({ doc }: ReversiaIsActiveArgs<Product>) => doc._status === 'published',
```

`isActive` must be a function. For configs that are not type-checked, the plugin also verifies this at startup and throws when it finds anything else.

When a resource has an `isActive` function:

- `GET /reversia/resources-definition` reports `deactivable: true` for it.
- Every item from `GET /reversia/resources` and `GET /reversia/resource` carries `properties: { active: <result> }`.

Resources without one are unchanged: no `deactivable` flag, no `properties`.

There is nothing to configure on the plugin: it picks up `isActive` automatically from any exposed collection or global that declares it.

If `isActive` throws, the request fails with a 500 instead of reporting the document as active. A document that silently turned active would be queued for translation. Changing the fields `isActive` reads fires the usual `afterChange` hook on collections, so Reversia re-reads the document and re-evaluates it on the next sync.

## Hooks

The plugin installs an `afterChange` hook on every exposed collection to record changes in the sync queue. The hook is a no-op when the mutation came from Reversia itself (the insertion endpoint passes `context.reversiaInsertion = true`).
