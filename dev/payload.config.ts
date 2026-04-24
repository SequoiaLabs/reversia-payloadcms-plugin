import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import { ReversiaFieldBehavior, ReversiaFieldType, reversiaPlugin } from '../src/index.js';

export const TEST_API_KEY = 'test-reversia-api-key';

export default buildConfig({
  secret: 'test-secret-for-payload-reversia-plugin',

  db: sqliteAdapter({
    client: { url: 'file:./dev/test.db' },
  }),

  editor: lexicalEditor({}),

  localization: {
    defaultLocale: 'en',
    fallback: true,
    locales: [
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
      { code: 'es', label: 'Spanish' },
    ],
  },

  collections: [
    {
      slug: 'posts',
      labels: { singular: 'Post', plural: 'Posts' },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
        delete: () => true,
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          localized: true,
        },
        {
          name: 'content',
          type: 'richText',
          localized: true,
        },
        {
          name: 'slug',
          type: 'text',
          localized: true,
          custom: {
            reversia: { behavior: ReversiaFieldBehavior.SLUG },
          },
        },
        {
          name: 'externalUrl',
          type: 'text',
          localized: true,
          custom: {
            reversia: { type: ReversiaFieldType.LINK },
          },
        },
        {
          name: 'ogImage',
          type: 'text',
          localized: true,
          custom: {
            reversia: { type: ReversiaFieldType.MEDIUM },
          },
        },
        {
          name: 'metaDescription',
          type: 'textarea',
          localized: true,
        },
        {
          name: 'internalNotes',
          type: 'text',
          // NOT localized — should be ignored by plugin
        },
        {
          name: 'seo',
          type: 'group',
          fields: [
            {
              name: 'metaTitle',
              type: 'text',
              localized: true,
            },
          ],
        },
      ],
    },
    {
      slug: 'categories',
      labels: { singular: 'Category', plural: 'Categories' },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
        delete: () => true,
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          localized: true,
        },
        {
          name: 'description',
          type: 'textarea',
          localized: true,
        },
      ],
    },
    {
      slug: 'tags',
      labels: { singular: 'Tag', plural: 'Tags' },
      // No localized fields — should NOT be exposed
      access: {
        read: () => true,
        create: () => true,
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      slug: 'unique-docs',
      labels: { singular: 'Unique Doc', plural: 'Unique Docs' },
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
        delete: () => true,
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          localized: true,
          unique: true,
        },
      ],
    },
  ],

  globals: [
    {
      slug: 'site-settings',
      label: 'Site Settings',
      access: {
        read: () => true,
        update: () => true,
      },
      fields: [
        {
          name: 'siteTitle',
          type: 'text',
          localized: true,
        },
        {
          name: 'siteDescription',
          type: 'textarea',
          localized: true,
        },
        {
          name: 'analyticsId',
          type: 'text',
          // NOT localized
        },
      ],
    },
    {
      slug: 'footer-links',
      label: 'Footer Links',
      access: {
        read: () => true,
        update: () => true,
      },
      fields: [
        {
          name: 'links',
          type: 'array',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'name',
                  type: 'text',
                  required: true,
                  localized: true,
                },
                {
                  name: 'url',
                  type: 'text',
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    },
  ],

  plugins: [
    reversiaPlugin({
      apiKey: TEST_API_KEY,
    }),
  ],

  typescript: {
    autoGenerate: false,
  },
});
