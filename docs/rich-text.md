# Rich text & JSON fields

PayloadCMS `richText` (Lexical) and `json` fields store structured trees. If we shipped the full tree to Reversia, the translation pipeline would treat every string value — `"paragraph"`, `"h2"`, `"ltr"`, `"image/webp"`, `"info"`, and so on — as translatable copy. That's wrong.

This plugin extracts only the leaf strings you actually want translated, keyed by their location in the tree, then rebuilds the tree on insertion.

## How it works

1. **Extract.** During a `/resources` or `/resource` call, each `richText` / `json` value is walked. A leaf string is emitted if its *key path* (object keys only; array indices don't count) matches one of the configured patterns. The output is a flat map:
   ```json
   {
     "/root/children/0/children/0/text": "Explore the untold…",
     "/root/children/4/fields/media/alt": "Curving abstract shapes…"
   }
   ```
   Keys are RFC 6901 JSON Pointers.

2. **Ship.** The map is `JSON.stringify`d and sent under the field's path in the resource `content`. Reversia sees one string per map entry.

3. **Insert.** When Reversia pushes translations back via `/resources-insert`, the plugin:
   - Fetches the source-locale document.
   - Deep-clones its original tree.
   - Writes each translated string at its pointer.
   - Saves the cloned tree on the target locale.

Structure, formatting, block IDs, media references — everything non-translatable is preserved exactly as the source.

## `translatableKeys`

Declare which leaves to extract per field:

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

For `json` without `translatableKeys`, the raw value is shipped as a JSON string (back-compatible behaviour).

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

## Escape hatch: `extract` / `apply`

When you need full control — a custom serialiser, or a field shape where key matching isn't expressive enough — provide a pair of functions:

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
- Providing `extract` bypasses `translatableKeys` entirely.

## Why JSON Pointers?

They are RFC 6901, symmetric to encode and decode, and free of the dot-vs-bracket ambiguity you hit with `a.b[0].c`-style paths. Segments containing `/` or `~` are escaped as `~1` and `~0`. The pointer is opaque to Reversia — it just round-trips it back in the translation map.
