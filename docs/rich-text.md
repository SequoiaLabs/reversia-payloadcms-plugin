# Rich text, JSON, groups, arrays & blocks

Any top-level field that contains at least one localized leaf — `richText`, `json`, `group` with localized subfields, `array`, `blocks` — is treated as a **container**. Containers ship one entry to Reversia per top-level field, with the value being a JSON-stringified map of `{ <jsonPointer>: <translatableString> }` covering every translatable atom inside.

This eliminates two classes of problem:

- The plugin never ships non-localized siblings or structural keys (`"paragraph"`, `"image/webp"`, `"ltr"`, …) to Reversia.
- Insertion always rebuilds the full container from a deep clone of the source-locale value, so required nested siblings (`id`, `blockType`, non-localized subfields, sub-objects) are preserved and Payload validation passes.

## How it works

1. **Extract.** During `/resources` or `/resource`, every top-level localized field is walked.
   - For a **scalar** localized field (`text`, `textarea`, `number`, …), the value is shipped as a primitive.
   - For a **container**, the plugin walks every localized leaf inside it. Scalar leaves emit `{ pointerToLeaf: value }`. Nested `richText` / `json` leaves with `translatableKeys` further extract their sub-leaves and prefix each sub-pointer with the leaf's pointer in the container. The aggregated map is `JSON.stringify`d.

   Example for a `body` blocks field:
   ```json
   {
     "body": "{\"/0/heading\":\"Welcome\",\"/2/heading\":\"Subscribe\",\"/1/message\":\"Buy now\"}"
   }
   ```

   Example for a top-level `richText`:
   ```json
   {
     "content": "{\"/root/children/0/children/0/text\":\"Explore the untold…\",\"/root/children/4/fields/media/alt\":\"Curving abstract shapes…\"}"
   }
   ```

   Pointers are RFC 6901 JSON Pointers anchored at the **container's value** root.

2. **Ship.** One entry per top-level field. `contentTypes[<fieldName>]` is `"JSON"` for every container.

3. **Insert.** When Reversia pushes translations back via `/resources-insert`, the plugin:
   - Fetches the source-locale document.
   - Deep-clones each top-level container as the base of `updateData` (PrestaShop-style "clone source, replace with what we got").
   - For each entry in `data`: if it's a container, parses the JSON-pointer map and writes each translated string at its pointer in the cloned container.
   - Saves the rebuilt structure to the target locale.

Structure, formatting, block IDs, media references — everything non-translatable is preserved exactly as in the source.

## `translatableKeys`

`translatableKeys` declares which leaves to extract for a `richText` or `json` field. It applies to that field whether it's a top-level localized field or an inner leaf inside a container.

```ts
{
  name: 'body',
  type: 'richText',
  localized: true,
  custom: {
    reversia: {
      translatableKeys: ['text', 'url', 'alt'],
    },
  },
}
```

### Defaults

| Field type | Default `translatableKeys`         |
| ---------- | ---------------------------------- |
| `richText` | `['text', 'url', 'alt']`           |
| `json`     | none — extraction requires opt-in  |

For a `json` leaf without `translatableKeys`, the raw value is shipped as one JSON string at the leaf's pointer (back-compatible behaviour).

### Pattern syntax

| Pattern        | Matches                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `text`         | Any key named `text` at any depth. Shorthand for `**.text`.                |
| `root.foo`     | Path anchored at the root.                                                 |
| `foo.*.bar`    | `*` matches exactly one key segment.                                        |
| `foo.**.bar`   | `**` matches zero or more key segments.                                     |

Array indices are transparent — `*` / `**` traverse across arrays without you having to think about them. Only object keys participate in matching.

### Examples

```ts
// Ship every `text` and every `alt`, nothing else.
translatableKeys: ['text', 'alt']

// Ship only `label` keys that sit directly under an `options` array.
translatableKeys: ['options.*.label']

// Ship `title` anywhere under `seo`.
translatableKeys: ['seo.**.title']

// Anchor a very specific path.
translatableKeys: ['root.metadata.description']
```

## Containers other than richText / json

You don't need any annotation — declaring a `localized: true` subfield anywhere inside a `group`, `array`, or `blocks` is enough. The plugin auto-detects the top-level field as a container and discovers every localized leaf inside.

```ts
// Group: emits one entry keyed by `seo`.
//   `{ "seo": "{\"/metaTitle\":\"…\"}" }`
{
  name: 'seo',
  type: 'group',
  fields: [
    { name: 'metaTitle', type: 'text', localized: true },
    { name: 'analyticsId', type: 'text' /* not in the map — non-localized */ },
  ],
}

// Array: emits one entry per array item under the same JSON.
//   `{ "items": "{\"/0/title\":\"A\",\"/1/title\":\"B\"}" }`
{
  name: 'items',
  type: 'array',
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'sku', type: 'text' /* non-localized — not shipped */ },
  ],
}

// Blocks: each block contributes leaves filtered by `blockType`.
//   `{ "body": "{\"/0/heading\":\"…\",\"/2/message\":\"…\"}" }`
{
  name: 'body',
  type: 'blocks',
  blocks: [
    { slug: 'hero', fields: [{ name: 'heading', type: 'text', localized: true }] },
    { slug: 'callout', fields: [{ name: 'message', type: 'text', localized: true }] },
  ],
}
```

Pointers reflect the container's actual structure: `/<index>/<subfield>` for arrays/blocks, `/<subfield>` for groups, `/root/children/...` for richText.

## Escape hatch: `extract` / `apply`

When you need full control — a custom serialiser, or a top-level field whose shape doesn't fit the auto-extractor — provide a pair of functions on the top-level field:

```ts
{
  name: 'markdown',
  type: 'json',
  localized: true,
  custom: {
    reversia: {
      extract: (value) => value.raw,
      apply: (sourceValue, translated) => ({
        ...sourceValue,
        raw: translated,
      }),
    },
  },
}
```

- `extract(value)` receives the raw field value and must return a single string shipped to Reversia.
- `apply(sourceValue, translated)` receives the source-locale value plus the translated string and must return the value stored on the target locale.
- Both must be set together. Setting `extract` without `apply` throws at request time.
- Providing `extract` bypasses the container's auto-extraction entirely; the field ships as one opaque translation rather than a JSON-pointer map.

`extract` / `apply` is only honoured on **top-level** localized fields; it is ignored on inner leaves of a container.

## Why JSON Pointers?

They are RFC 6901, symmetric to encode and decode, and free of the dot-vs-bracket ambiguity you hit with `a.b[0].c`-style paths. Segments containing `/` or `~` are escaped as `~1` and `~0`. The pointer is opaque to Reversia — it just round-trips it back in the translation map.
