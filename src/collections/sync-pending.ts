import type { CollectionConfig } from 'payload';

export const reversiaSyncPendingCollection: CollectionConfig = {
  slug: 'reversia-sync-pending',
  admin: {
    hidden: true,
  },
  access: {
    // Hidden, internal queue — no public read/write access by default.
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
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
};
