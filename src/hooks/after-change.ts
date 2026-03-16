import type { CollectionAfterChangeHook } from 'payload'

export function createAfterChangeHook(resourceType: string): CollectionAfterChangeHook {
  return async ({ doc, req, context }) => {
    if (context?.reversiaInsertion) {
      return doc
    }

    try {
      const existing = await req.payload.find({
        collection: 'reversia-sync-pending',
        where: {
          and: [
            { resourceType: { equals: resourceType } },
            { resourceId: { equals: String(doc.id) } },
          ],
        },
        limit: 1,
      })

      if (existing.docs.length === 0) {
        await req.payload.create({
          collection: 'reversia-sync-pending',
          data: {
            resourceType,
            resourceId: String(doc.id),
          },
        })
      }
    } catch {
      req.payload.logger.error(
        `[reversia] Failed to track sync pending for ${resourceType}:${doc.id}`,
      )
    }

    return doc
  }
}
