# Field annotations

Any PayloadCMS field can carry a `custom.reversia` block that tells the plugin how to treat it.

```ts
import { ReversiaFieldType, ReversiaFieldBehavior } from '@sequoialabs/payload-plugin-reversia';

{
  name: 'slug',
  type: 'text',
  localized: true,
  custom: {
    reversia: {
      behavior: ReversiaFieldBehavior.SLUG,
      asLabel: false,
    },
  },
}
```

## Where annotations apply

The plugin discovers translatable resources at the **top-level field** granularity. A top-level field that has any localized leaf — itself, or any descendant — emits one entry. `custom.reversia` placed on a top-level field configures that entry:

| Annotation         | Top-level scalar (`text`, `textarea`, …) | Top-level container (`group`, `array`, `blocks`, `richText`, `json` with localized leaves) | Inner leaf inside a container |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| `type`             | ✅ overrides inferred                    | ✅ overrides inferred                                                                      | — (always extracted)          |
| `behavior`         | ✅                                       | ✅                                                                                         | —                             |
| `asLabel`          | ✅                                       | ✅                                                                                         | —                             |
| `selected`         | ✅                                       | ✅                                                                                         | —                             |
| `translatableKeys` | —                                        | only on a `richText` / `json` top-level field                                              | ✅ (per `richText` / `json` leaf) |
| `extract` / `apply`| —                                        | ✅ (replaces auto-extraction)                                                              | — (ignored on inner leaves)   |

## All options

| Key                | Type                                               | Purpose                                                                 |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `type`             | `'TEXT' \| 'HTML' \| 'JSON' \| 'LINK' \| 'MEDIUM'` | Override inferred Reversia content type for the resource entry.         |
| `behavior`         | `'slug'`                                           | Enables behavior-specific handling on the Reversia side.                |
| `asLabel`          | `boolean`                                          | Marks the top-level entry as the resource label shown in Reversia UI.   |
| `selected`         | `boolean`                                          | If `false`, the entry is excluded from translation by default.          |
| `translatableKeys` | `string[]`                                         | Whitelist of JSON key paths to ship for `richText` / `json`. See [Rich text](./rich-text.md). |
| `extract`          | `(value) => string`                                | Escape hatch on a top-level field: fully custom serialisation. Must be paired with `apply`. |
| `apply`            | `(sourceValue, translated) => unknown`             | Inverse of `extract`. Rebuilds the field value on insertion.            |

## Content type inference

When `type` is omitted the plugin infers it from the top-level field's role:

| Top-level field shape                                                | Inferred Reversia type   |
| -------------------------------------------------------------------- | ------------------------ |
| Localized scalar (`text`, `textarea`, `email`, `code`, `select`, …)  | `TEXT` (no annotation emitted) |
| Localized `richText` / `json`                                        | `JSON`                   |
| Non-localized `group` / `array` / `blocks` with localized descendants | `JSON`                   |

Containers always ship as `JSON` (a stringified JSON-pointer map). Scalars ship as primitives. See [Rich text & JSON fields](./rich-text.md) for the extraction details.

## Labels

The first localized field named `title` or `name` (and that is *not* a container) is auto-promoted to `asLabel`. Set `asLabel: true` / `asLabel: false` explicitly to override.

## `selected: false`

Fields with `selected: false` still appear in the resource definition so Reversia knows about them, but are unchecked by default in the translation UI.

## Behaviors

`behavior: 'slug'` tells Reversia to treat the value as a URL slug — typically lowercased, hyphenated, and possibly transliterated per target locale.

## Examples

```ts
// A meta image URL — ship as-is, don't translate the filename.
{
  name: 'ogImage',
  type: 'text',
  localized: true,
  custom: {
    reversia: { type: ReversiaFieldType.MEDIUM },
  },
}

// A localized rich-text body — only translate text/url/alt (the default).
{
  name: 'body',
  type: 'richText',
  localized: true,
}

// A localized JSON config — only translate the `label` key at any depth.
{
  name: 'widgetConfig',
  type: 'json',
  localized: true,
  custom: {
    reversia: { translatableKeys: ['label'] },
  },
}

// A blocks field with localized inner subfields — auto-detected as a container,
// no annotation needed.
{
  name: 'body',
  type: 'blocks',
  blocks: [
    { slug: 'hero', fields: [{ name: 'heading', type: 'text', localized: true }] },
  ],
}
```
