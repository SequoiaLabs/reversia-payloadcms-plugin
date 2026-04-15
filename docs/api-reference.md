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

---

## GET `/resources-definition`

Describes each exposed resource type: label, field configuration, expected content types, count.

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
      "body":    { "label": "Body", "type": "JSON" }
    }
  }
]
```

## GET `/resources`

Streams translatable documents. Accepts:

| Query     | Type                    | Description                                           |
| --------- | ----------------------- | ----------------------------------------------------- |
| `types`   | comma-separated strings | Restrict to these resource types.                     |
| `limit`   | integer                 | Max documents per page. Default `100`.                |
| `cursor`  | opaque string           | Returned by the previous page. `null` on last page.    |

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
            "body": "{\"/root/children/0/children/0/text\":\"…\"}"
          },
          "contentTypes": { "body": "JSON" }
        }
      ]
    }
  ],
  "cursor": "eyJ0eXBlIjoicGF5bG9hZGNtczpwb3N0cyIsImlkIjoiYWJjMTIzIn0="
}
```

For `richText` / `json` fields with `translatableKeys`, the value is a stringified JSON Pointer map. See [Rich text & JSON fields](./rich-text.md).

## GET `/resource`

Single-document variant.

| Query          | Required | Description                                          |
| -------------- | -------- | ---------------------------------------------------- |
| `resourceType` | yes      | e.g. `payloadcms:posts` or `payloadcms:global:site`. |
| `resourceId`   | yes for collections | Payload document ID.                       |

## PUT `/resources-insert`

Body is an array of insertion items:

```json
[
  {
    "type": "payloadcms:posts",
    "id": "abc123",
    "sourceLocale": "en",
    "targetLocale": "fr",
    "data": {
      "title": "Mon premier article",
      "body": "{\"/root/children/0/children/0/text\":\"…\"}"
    }
  }
]
```

For each item the plugin:

1. Resolves the resource type to a collection or global.
2. Fetches the `sourceLocale` document if any field needs tree rehydration (richText, `translatableKeys`, or `apply`).
3. Rehydrates each applicable field by writing translations onto a clone of the source tree.
4. Writes the result to `targetLocale`, passing `context.reversiaInsertion = true` so the `afterChange` hook does not re-queue.

Response:

```json
{
  "errors": [],
  "0": { "index": 0, "type": "payloadcms:posts", "id": "abc123", "diff": { "title": "…previous value…" } }
}
```

`diff` lists the target-locale values that existed before the write, so Reversia can detect and report overwrites.

## GET `/resources-sync`

Returns items currently in the hidden `reversia-sync-pending` collection — resources that changed since the last confirmed sync.

## POST `/confirm-resources-sync`

Body: `{ "ids": ["..."] }`. Removes the listed sync-queue entries. Reversia calls this after it has ingested the corresponding resources.

## GET `/settings`

Plugin metadata and the locale list declared on the Payload config's `localization` block.

---

## Authentication

Every endpoint validates the key with `validateApiKey`. Missing or wrong keys return:

```json
{ "error": "Unauthorized" }
```

with HTTP `401`.

## Cursors

Cursors are base64-encoded `{ type, id }` pairs. They are opaque to callers — pass back exactly what the previous response returned.
