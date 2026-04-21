# @sequoialabs/payload-plugin-reversia

A [PayloadCMS](https://payloadcms.com/) plugin that integrates with [Reversia](https://reversia.tech), a translation SaaS platform, enabling seamless content localization and synchronization across multiple languages.

## How it works

1. The plugin scans your PayloadCMS config and detects every top-level field that contains at least one `localized: true` leaf — scalars, groups, arrays, blocks, richText, json all qualify.
2. When content changes, an `afterChange` hook records the resource in a hidden sync queue.
3. Reversia polls the plugin's HTTP endpoints to fetch translatable content.
4. Each resource entry is keyed by top-level field name. Scalars ship as plain values. **Containers ship one JSON-pointer map per field** containing only the localized atoms — non-localized siblings, structural keys, and unrelated data never reach Reversia.
5. Once translated, Reversia pushes translations back. The plugin **clones the source-locale document** as the base of the update, then overlays each translated leaf at its pointer — required nested siblings (block ids, `blockType`, non-localized subfields) are guaranteed to be present so Payload validation passes.
6. A confirmation endpoint clears processed items from the sync queue (`updatedAt`-based, so re-edits during translation aren't lost).

## Installation

```bash
npm install @sequoialabs/payload-plugin-reversia
# or
bun add @sequoialabs/payload-plugin-reversia
```

## Quick start

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

Then mark whichever fields are translatable. **You don't need to annotate containers** — declaring `localized: true` on any inner subfield is enough; the plugin auto-detects the top-level container and emits a single JSON-pointer entry for it.

```ts
// Top-level localized scalar — shipped as a primitive.
{ name: 'title', type: 'text', localized: true }

// Top-level richText — shipped as a JSON-pointer map of `text`/`url`/`alt`
// leaves by default.
{ name: 'body', type: 'richText', localized: true }

// Slug field — ship as text, mark behaviour for Reversia.
{
  name: 'slug',
  type: 'text',
  localized: true,
  custom: { reversia: { behavior: 'slug' } },
}

// Blocks container — auto-detected. One entry per page keyed by `body`,
// value: `{"/0/heading":"…","/2/heading":"…"}`.
{
  name: 'body',
  type: 'blocks',
  blocks: [
    { slug: 'hero', fields: [{ name: 'heading', type: 'text', localized: true }] },
  ],
}
```

## Documentation

- **[Configuration](./docs/configuration.md)** — plugin options, auth, what gets exposed.
- **[Field annotations](./docs/field-annotations.md)** — the `custom.reversia` metadata reference.
- **[Rich text & JSON fields](./docs/rich-text.md)** — `translatableKeys`, path patterns, and the `extract`/`apply` escape hatch.
- **[API reference](./docs/api-reference.md)** — HTTP endpoints consumed by the Reversia SaaS.
- **[Contributing](./CONTRIBUTING.md)** — local dev, linting, testing.

## Requirements

- PayloadCMS v3.0.0+
- Node.js 20+ or Bun
- At least one `localized: true` field on a collection or global

## License

MIT
