# Field annotations

Any PayloadCMS field can carry a `custom.reversia` block that tells the plugin how to treat it.

```ts
import { ReversiaFieldType, ReversiaFieldBehavior } from 'payload-plugin-reversia';

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

## All options

| Key                | Type                                               | Applies to             | Purpose                                                                 |
| ------------------ | -------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `type`             | `'TEXT' \| 'HTML' \| 'JSON' \| 'LINK' \| 'MEDIUM'` | any                    | Override inferred content type.                                         |
| `behavior`         | `'slug'`                                           | any                    | Enables behavior-specific handling on the Reversia side.                |
| `asLabel`          | `boolean`                                          | any localized string   | Marks the field as the resource label shown in Reversia UI.             |
| `selected`         | `boolean`                                          | any                    | If `false`, the field is excluded from translation by default.          |
| `translatableKeys` | `string[]`                                         | `richText`, `json`     | Whitelist of JSON key paths to ship. See [Rich text](./rich-text.md).   |
| `extract`          | `(value) => string`                                | `richText`, `json`     | Escape hatch: fully custom serialisation. Must be paired with `apply`.  |
| `apply`            | `(sourceValue, translated) => unknown`             | `richText`, `json`     | Inverse of `extract`. Rebuilds the field value on insertion.            |

## Content type inference

When `type` is omitted the plugin infers it from the PayloadCMS field type:

| Payload field type | Inferred Reversia type |
| ------------------ | ---------------------- |
| `richText`         | `JSON`                 |
| `json`             | `JSON`                 |
| everything else    | `TEXT` (no annotation) |

`TEXT` values are shipped as-is. `JSON` values go through the key-based extractor described in [Rich text & JSON fields](./rich-text.md).

## Labels

The first localized field named `title` or `name` is auto-promoted to `asLabel`. Set `asLabel: true` / `asLabel: false` explicitly to override.

## `selected: false`

Fields with `selected: false` still appear in the resource definition so Reversia knows about them, but are unchecked by default in the translation UI.

## Behaviors

`behavior: 'SLUG'` tells Reversia to treat the value as a URL slug — typically lowercased, hyphenated, and possibly transliterated per target locale.

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
```
