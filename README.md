# payload-plugin-reversia

A [PayloadCMS](https://payloadcms.com/) plugin that integrates with [Reversia](https://reversia.tech), a translation SaaS platform, enabling seamless content localization and synchronization across multiple languages.

## How it works

1. The plugin scans your PayloadCMS config and detects all localized fields across collections and globals.
2. When content changes, an `afterChange` hook records it in a hidden sync queue.
3. Reversia polls the plugin's HTTP endpoints to fetch translatable content.
4. For `richText` / `json` fields, only the leaf strings you mark as translatable are shipped — the structure is kept local.
5. Once translated, Reversia pushes translations back. The plugin rehydrates the original tree and saves it on the target locale.
6. A confirmation endpoint clears processed items from the sync queue.

## Installation

```bash
npm install payload-plugin-reversia
# or
bun add payload-plugin-reversia
```

## Quick start

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

Then on a localized field:

```ts
{
  name: 'body',
  type: 'richText',
  localized: true,
  // Default translatableKeys: ['text', 'url', 'alt']
}

{
  name: 'slug',
  type: 'text',
  localized: true,
  custom: {
    reversia: { behavior: 'slug' },
  },
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
