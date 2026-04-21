# API reference

All endpoints are mounted under `/api/reversia/` on your Payload server and require authentication via `X-API-Key` header (or `apiKey` query string).

| Method | Path                         | Purpose                                              |
| ------ | ---------------------------- | ---------------------------------------------------- |
| GET    | `/settings`                  | Plugin config and locale list.                       |
| GET    | `/resources-definition`      | Schema of every exposed resource type.               |
| GET    | `/resources`                 | Paginated stream of translatable documents.          |
| GET    | `/resource`                  | Fetch one resource by `type` + `id`.                 |
| GET    | `/resources-sync`            | Resources in the sync queue awaiting translation.    |
| PUT    | `/resources-insert`          | Write translated content back into Payload.          |
| POST   | `/confirm-resources-sync`    | Confirm a sync batch and clear it from the queue.    |

> **Wire model.** Every entry in `content` / `data` is keyed by a **top-level field name**. Scalar localized fields ship as plain strings. Structured containers (group, array, blocks, richText, json that hold localized leaves) ship as a single `JSON`-typed value: a `JSON.stringify`d map of `{ <jsonPointer>: <translatableString> }` covering only the localized atoms inside that container. Reversia's parser walks the JSON; you never see non-localized siblings.

---

## GET `/resources-definition`

Describes each exposed resource type: label, top-level field configuration, expected content types, count.

```json
[
  {
    "type": "payloadcms:posts",
    "label": { "singular": "Post", "plural": "Posts" },
    "group": "payloadcms",
    "version": "1.0.0",
    "configurationType": "MULTIPLE",
    "count": 42,
    "synchronizable": true,
    "configuration": {
      "title":   { "label": "Title", "asLabel": true },
      "slug":    { "label": "Slug", "behavior": "slug" },
      "content": { "label": "Content", "type": "JSON" },
      "seo":     { "label": "Seo", "type": "JSON" },
      "body":    { "label": "Body", "type": "JSON" }
    }
  }
]
```

`configuration` keys map 1:1 to the keys of `content` in `/resources` and the keys of `data` in `/resources-insert`. Container fields (any top-level field that has at least one localized descendant) report `type: "JSON"` even when the top-level field itself isn't `richText` / `json`.

## GET `/resources`

Streams translatable documents. Accepts:

| Query     | Type                    | Description                                           |
| --------- | ----------------------- | ----------------------------------------------------- |
| `types`   | comma-separated strings | Restrict to these resource types.                     |
| `limit`   | integer                 | Max documents per page. Default `100`, capped at `1000`. |
| `cursor`  | opaque string           | Returned by the previous page. `null` on last page.   |

Response:

```json
{
  "content": [
    {
      "type": "payloadcms:posts",
      "data": [
        {
          "id": "abc123",
          "label": "My first post",
          "content": {
            "title": "My first post",
            "slug": "my-first-post",
            "content": "{\"/root/children/0/children/0/text\":\"Hello world\"}",
            "seo":     "{\"/metaTitle\":\"My first post\"}",
            "body":    "{\"/0/heading\":\"Welcome\",\"/2/heading\":\"Subscribe\",\"/1/message\":\"Buy now\"}"
          },
          "contentTypes": {
            "content": "JSON",
            "seo": "JSON",
            "body": "JSON"
          }
        }
      ]
    }
  ],
  "cursor": "eyJ0eXBlIjoicGF5bG9hZGNtczpwb3N0cyIsImlkIjoiYWJjMTIzIn0"
}
```

For container fields, the value is always a stringified JSON-pointer map. Pointers are anchored at the container's value root (`/metaTitle` for the `seo` group, `/0/heading` for the first item in the `body` blocks array, etc.). See [Rich text & JSON fields](./rich-text.md) for the extraction rules.

## GET `/resource`

Single-document variant.

| Query          | Required             | Description                                          |
| -------------- | -------------------- | ---------------------------------------------------- |
| `resourceType` | yes                  | e.g. `payloadcms:posts` or `payloadcms:global:site`. |
| `resourceId`   | yes for collections  | Payload document ID.                                 |

Response shape mirrors a single entry in `/resources`.`data[]`.

## PUT `/resources-insert`

Body is an array of insertion items. Each item's `data` is keyed by top-level field name — exactly the same keys you saw in `/resources` `content`.

```json
[
  {
    "type": "payloadcms:posts",
    "id": "abc123",
    "sourceLocale": "en",
    "targetLocale": "fr",
    "data": {
      "title": "Mon premier article",
      "slug": "mon-premier-article",
      "content": "{\"/root/children/0/children/0/text\":\"Bonjour le monde\"}",
      "seo":     "{\"/metaTitle\":\"Mon premier article\"}",
      "body":    "{\"/0/heading\":\"Bienvenue\"}"
    }
  }
]
```

For each item the plugin:

1. Resolves the resource type to a collection or global.
2. Fetches the **source-locale** document (always — needed both to populate non-localized siblings and to deserialize JSON-pointer maps).
3. Builds `updateData` by deep-cloning every top-level localized container out of the source. This is the "clone source, replace with what we got" pattern — required nested siblings (block ids, `blockType`, non-localized subfields, sub-objects) are guaranteed to be present so Payload's validation passes.
4. Overlays each entry in `data`:
   - **Scalar** keys are written verbatim.
   - **Container** keys are deserialized: parse the JSON-pointer map, take the source-locale clone of that container, write each translated string at its pointer, store the rebuilt structure.
5. Calls `payload.update(...)` (or `updateGlobal(...)`) with `context.reversiaInsertion = true` so the `afterChange` hook does not re-queue.

Response:

```json
{
  "errors": [],
  "0": {
    "index": 0,
    "type": "payloadcms:posts",
    "id": "abc123",
    "diff": {
      "title": "…previous EN title…",
      "seo": "{\"/metaTitle\":\"…previous meta title…\"}"
    }
  }
}
```

`diff` is keyed by the same top-level field name as `data`. Each value is the previous `target-locale` value (stringified for containers). Reversia's PayloadCMS handler maps these field names back to translation IDs before writing translation history (see `prestashop.service.ts` for the canonical pattern).

If an item has no recognised fields in its `data`, the plugin returns an explicit error string in `errors[]` and omits its `result[index]` entry — Reversia then marks those translations failed with reason "Not returned in insertion response" rather than silently corrupting the document.

## GET `/resources-sync`

Returns items currently in the hidden `reversia-sync-pending` collection — resources that changed since the last confirmed sync.

Cursor semantics use the row's `updatedAt` rather than `id`. This is portable across Mongo / Postgres / SQLite (SQLite reuses deleted ids, which would otherwise let `confirm-resources-sync` sweep entries that were re-edited after the cursor was issued).

```json
{
  "content": [
    {
      "type": "payloadcms:posts",
      "data": [{ "id": "payloadcms:posts", "content": { "identifiers": ["abc123", "def456"] } }]
    }
  ],
  "cursor": "eyJ0eXBlIjoicmV2ZXJzaWEtc3luYy1wZW5kaW5nIiwiaWQiOiIyMDI2LTA0LTE2VDExOjAxOjAxLjQwOFoifQ"
}
```

`cursor` is non-null whenever the response contains rows. Continue polling while you receive entries; an empty `content` (and `cursor: null`) means you're caught up.

## POST `/confirm-resources-sync`

Body:

```json
{ "cursor": "<cursor returned by /resources-sync>" }
```

Removes every pending row whose `updatedAt` is `<=` the cursor's checkpoint. Rows re-edited *after* the cursor was issued get a fresh `updatedAt` (the `afterChange` hook deletes + recreates the row), so they survive a stale confirm.

Response:

```json
{ "success": true, "deleted": 12 }
```

## GET `/settings`

Plugin metadata and the locale list declared on the Payload config's `localization` block.

```json
{
  "platform": "payloadcms",
  "pluginVersion": "0.1.0",
  "languages": [
    { "code": "en", "label": "English" },
    { "code": "fr", "label": "French" }
  ],
  "defaultLocale": "en"
}
```

---

## Authentication

Every endpoint validates the key via `crypto.timingSafeEqual` against the configured `apiKey`. Missing or wrong keys return `401 { "error": "Invalid API key" }`. An empty / unset `apiKey` at plugin init throws — the plugin refuses to start in an unauthenticated state.

## Cursors

Cursors are base64url-encoded JSON `{ "type": "...", "id": "..." }`. Opaque to callers — pass back exactly what the previous response returned. Decoding is delimiter-free, so ids containing `|` or other characters round-trip correctly.

## Limits

`limit` query params on `/resources` and `/resources-sync` are clamped to `[1, 1000]`. Values outside the range, NaN, or omitted fall back to the default (`100`).
