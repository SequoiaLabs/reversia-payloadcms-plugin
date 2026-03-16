# payload-plugin-reversia

A [PayloadCMS](https://payloadcms.com/) plugin that integrates with [Reversia](https://reversia.tech), a translation SaaS platform, enabling seamless content localization and synchronization across multiple languages.

## How It Works

1. The plugin scans your PayloadCMS config and detects all localized fields across collections and globals.
2. When content changes, an `afterChange` hook records it in a hidden sync queue.
3. Reversia polls the plugin's API endpoints to fetch translatable content.
4. Once translated, Reversia pushes translations back via the insertion endpoint.
5. A confirmation endpoint clears processed items from the sync queue.

## Installation

```bash
npm install payload-plugin-reversia
# or
bun add payload-plugin-reversia
```

## Configuration

Add the plugin to your PayloadCMS config:

```typescript
import { buildConfig } from 'payload'
import { reversiaPlugin } from 'payload-plugin-reversia'

export default buildConfig({
  // ... your config
  plugins: [
    reversiaPlugin({
      apiKey: process.env.REVERSIA_API_KEY!,
      enabledCollections: ['posts', 'pages'], // optional: whitelist specific collections
      enabledGlobals: ['site-settings'],       // optional: whitelist specific globals
    }),
  ],
})
```

### Options

| Option                | Type               | Required | Description                                      |
|-----------------------|--------------------|----------|--------------------------------------------------|
| `apiKey`              | `string`           | Yes      | API key for authenticating Reversia requests      |
| `enabledCollections`  | `CollectionSlug[]` | No       | Whitelist of collections to enable for translation |
| `enabledGlobals`      | `string[]`         | No       | Whitelist of globals to enable for translation     |
| `disabled`            | `boolean`          | No       | Disable the plugin entirely (default: `false`)     |

## Field Type Annotations

You can customize how Reversia interprets your fields using `custom.reversia` metadata:

```typescript
{
  name: 'slug',
  type: 'text',
  localized: true,
  custom: {
    reversia: {
      type: 'TEXT',       // TEXT | HTML | JSON | LINK | MEDIUM
      behavior: 'SLUG',   // optional: SLUG
      asLabel: true,       // use this field as the resource label
      selected: true,      // pre-select for translation
    },
  },
}
```

**Automatic type inference:**
- `richText` fields -> `HTML`
- `json` fields -> `JSON`
- All others -> `TEXT`

## API Endpoints

All endpoints are mounted under `/api/reversia/` and require authentication via `X-API-Key` header or `apiKey` query parameter.

| Method | Endpoint                    | Description                                  |
|--------|-----------------------------|----------------------------------------------|
| GET    | `/settings`                 | Plugin config and available languages         |
| GET    | `/resources-definition`     | Schema definitions for translatable resources |
| GET    | `/resources`                | Paginated stream of translatable content      |
| GET    | `/resource`                 | Single resource by type and ID                |
| GET    | `/resources-sync`           | Pending resources awaiting translation sync   |
| PUT    | `/resources-insert`         | Insert translated content back into Payload   |
| POST   | `/confirm-resources-sync`   | Confirm sync completion and clear queue       |

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Watch mode
bun run dev

# Run tests
bun test
```

## Requirements

- PayloadCMS v3.0.0+
- Node.js or Bun runtime
- At least one localized field in your collections/globals

## License

MIT
