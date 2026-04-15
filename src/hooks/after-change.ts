import type { CollectionAfterChangeHook } from 'payload';

/**
 * Records a pending-sync entry whenever a tracked document changes.
 *
 * Each call deletes any existing pending row for the same (resourceType,
 * resourceId) pair and creates a fresh one. This guarantees the row's id is
 * greater than every cursor previously handed out, so a `confirm` call that
 * clears `id ≤ cursor.id` never eats a pending change that arrived after the
 * cursor was issued.
 */
export function createAfterChangeHook(resourceType: string): CollectionAfterChangeHook {
  return async ({ doc, req, context }) => {
    if (context?.reversiaInsertion) {
      return doc;
    }

    const resourceId = String(doc.id);

    try {
      const existing = await req.payload.find({
        collection: 'reversia-sync-pending',
        where: {
          and: [{ resourceType: { equals: resourceType } }, { resourceId: { equals: resourceId } }],
        },
        limit: 100,
      });

      for (const row of existing.docs) {
        await req.payload.delete({
          collection: 'reversia-sync-pending',
          id: row.id,
        });
      }

      await req.payload.create({
        collection: 'reversia-sync-pending',
        data: { resourceType, resourceId },
      });
    } catch (error) {
      req.payload.logger.error(
        { err: error, resourceType, resourceId },
        '[reversia] Failed to track sync pending',
      );
    }

    return doc;
  };
}
