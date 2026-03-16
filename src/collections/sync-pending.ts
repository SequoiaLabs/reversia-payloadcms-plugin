import type { CollectionConfig } from 'payload'

export const reversiaSyncPendingCollection: CollectionConfig = {
  slug: 'reversia-sync-pending',
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'resourceType',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'resourceId',
      type: 'text',
      required: true,
      index: true,
    },
  ],
}
