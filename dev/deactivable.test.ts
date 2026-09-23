import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  type CollectionConfig,
  type Endpoint,
  type GlobalConfig,
  getPayload,
  type Payload,
} from 'payload';
import { createResourceEndpoint } from '../src/endpoints/resource.js';
import { createResourcesEndpoint } from '../src/endpoints/resources.js';
import { createResourcesDefinitionEndpoint } from '../src/endpoints/resources-definition.js';
import {
  type ResourceDefinition,
  type ResourceResponse,
  type ReversiaIsActive,
  type ReversiaIsActiveArgs,
  type ReversiaPluginConfig,
  type ReversiaResourceCustom,
  reversiaPlugin,
  type StreamResponse,
} from '../src/index.js';
import { expectDefined, invokeEndpoint, withKey } from './helpers.js';
import config, { TEST_API_KEY } from './payload.config.js';

/**
 * `isActive` / deactivable tests.
 *
 * The dev config declares no `isActive`, so the registered endpoints prove
 * the legacy shape is unchanged. For the deactivable path we clone the
 * `categories` and `site-settings` configs with a `custom.reversia.isActive`
 * and build the endpoint factories by hand against the same Payload instance.
 */

let payload: Payload;

type Doc = Record<string, unknown>;

const categoryIsActive: ReversiaIsActive = ({ doc }) =>
  typeof doc.description === 'string' && doc.description.length > 0;

function buildEndpoints(
  pluginConfig: ReversiaPluginConfig,
  customs: { categories?: Doc; siteSettings?: Doc } = {},
): Endpoint[] {
  const collectionsMap = new Map<string, CollectionConfig>();
  const globalsMap = new Map<string, GlobalConfig>();

  for (const collection of payload.config.collections) {
    if (collection.slug === 'categories') {
      collectionsMap.set(collection.slug, {
        ...(collection as unknown as CollectionConfig),
        custom: customs.categories ?? {},
      });
    }
  }

  for (const global of payload.config.globals) {
    if (global.slug === 'site-settings') {
      globalsMap.set(global.slug, {
        ...(global as unknown as GlobalConfig),
        custom: customs.siteSettings ?? {},
      });
    }
  }

  return [
    createResourcesDefinitionEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourcesEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourceEndpoint(pluginConfig, collectionsMap, globalsMap),
  ];
}

async function getDefinitions(endpoints: Endpoint[]): Promise<ResourceDefinition[]> {
  const res = await invokeEndpoint<ResourceDefinition[]>(
    endpoints,
    payload,
    'get',
    '/reversia/resources-definition',
    { headers: withKey() },
  );
  expect(res.status).toBe(200);
  return res.json();
}

async function streamAll(endpoints: Endpoint[]): Promise<StreamResponse> {
  const res = await invokeEndpoint<StreamResponse>(
    endpoints,
    payload,
    'get',
    '/reversia/resources',
    {
      headers: withKey(),
      searchParams: { limit: '1000' },
    },
  );
  expect(res.status).toBe(200);
  return res.json();
}

function findItem(stream: StreamResponse, type: string, id: string) {
  const group = stream.content.find((c) => c.type === type);
  return expectDefined(
    group?.data.find((d) => d.id === id),
    `item ${type}/${id} not in stream`,
  );
}

let activeId: string;
let inactiveId: string;

beforeAll(async () => {
  payload = await getPayload({ config, key: 'deactivable' });

  const active = await payload.create({
    collection: 'categories',
    locale: 'en',
    data: { name: 'Deactivable active', description: 'Has a description' },
  });
  const inactive = await payload.create({
    collection: 'categories',
    locale: 'en',
    data: { name: 'Deactivable inactive' },
  });
  activeId = String(active.id);
  inactiveId = String(inactive.id);

  await payload.updateGlobal({
    slug: 'site-settings',
    locale: 'en',
    data: { siteTitle: 'Deactivable site' },
  });
});

afterAll(async () => {
  await payload.db.destroy?.();
});

describe('without isActive', () => {
  test('definitions omit deactivable and items omit properties', async () => {
    const endpoints = buildEndpoints({ apiKey: TEST_API_KEY });
    const definitions = await getDefinitions(endpoints);

    for (const def of definitions) {
      expect(def.deactivable).toBeUndefined();
    }

    const stream = await streamAll(endpoints);
    expect(findItem(stream, 'payloadcms:categories', activeId).properties).toBeUndefined();
    expect(findItem(stream, 'payloadcms:global:site-settings', 'site-settings').properties).toBe(
      undefined,
    );
  });
});

describe('isActive declared in custom.reversia', () => {
  let endpoints: Endpoint[];

  beforeAll(() => {
    endpoints = buildEndpoints(
      { apiKey: TEST_API_KEY },
      {
        categories: { reversia: { isActive: categoryIsActive } },
        // Async, and reading the global's own data.
        siteSettings: {
          reversia: {
            isActive: async ({ doc, kind, slug }) =>
              kind === 'global' && slug === 'site-settings' && doc.siteTitle === 'Nope',
          } satisfies ReversiaResourceCustom,
        },
      },
    );
  });

  test('definitions advertise deactivable', async () => {
    const definitions = await getDefinitions(endpoints);
    const categories = expectDefined(definitions.find((d) => d.type === 'payloadcms:categories'));
    const settings = expectDefined(
      definitions.find((d) => d.type === 'payloadcms:global:site-settings'),
    );

    expect(categories.deactivable).toBe(true);
    expect(settings.deactivable).toBe(true);
  });

  test('stream items carry properties.active per document', async () => {
    const stream = await streamAll(endpoints);

    expect(findItem(stream, 'payloadcms:categories', activeId).properties).toEqual({
      active: true,
    });
    expect(findItem(stream, 'payloadcms:categories', inactiveId).properties).toEqual({
      active: false,
    });
    expect(findItem(stream, 'payloadcms:global:site-settings', 'site-settings').properties).toEqual(
      { active: false },
    );
  });

  test('single-resource endpoint carries properties.active', async () => {
    const collectionRes = await invokeEndpoint<ResourceResponse>(
      endpoints,
      payload,
      'get',
      '/reversia/resource',
      {
        headers: withKey(),
        searchParams: { resourceType: 'payloadcms:categories', resourceId: inactiveId },
      },
    );
    expect(collectionRes.status).toBe(200);
    expect((await collectionRes.json()).properties).toEqual({ active: false });

    const globalRes = await invokeEndpoint<ResourceResponse>(
      endpoints,
      payload,
      'get',
      '/reversia/resource',
      {
        headers: withKey(),
        searchParams: { resourceType: 'payloadcms:global:site-settings' },
      },
    );
    expect(globalRes.status).toBe(200);
    expect((await globalRes.json()).properties).toEqual({ active: false });
  });

  test('flipping the document flips properties.active', async () => {
    await payload.update({
      collection: 'categories',
      id: inactiveId,
      locale: 'en',
      data: { description: 'Now described' },
    });

    const stream = await streamAll(endpoints);
    expect(findItem(stream, 'payloadcms:categories', inactiveId).properties).toEqual({
      active: true,
    });

    await payload.update({
      collection: 'categories',
      id: inactiveId,
      locale: 'en',
      data: { description: '' },
    });
  });
});

describe('isActive failures', () => {
  test('a throwing isActive fails the request instead of reporting active', async () => {
    const endpoints = buildEndpoints(
      { apiKey: TEST_API_KEY },
      {
        categories: {
          reversia: {
            isActive: () => {
              throw new Error('boom');
            },
          },
        },
      },
    );

    await expect(streamAll(endpoints)).rejects.toThrow(/isActive failed for collection categories/);
  });
});

describe('isActive validation', () => {
  test('the plugin refuses a non-function isActive at startup', () => {
    const apply = reversiaPlugin({ apiKey: TEST_API_KEY });

    expect(() =>
      apply({
        collections: [
          {
            slug: 'broken',
            fields: [{ name: 'title', type: 'text', localized: true }],
            // The cast below stands in for an untyped (JavaScript) config;
            // typed configs reject this at compile time.
            custom: { reversia: { isActive: true } },
          },
        ],
      } as unknown as Parameters<typeof apply>[0]),
    ).toThrow(/custom\.reversia\.isActive on "broken" must be a function, got boolean/);
  });

  test('custom.reversia is typed on collection, global and field configs', () => {
    // Compile-time checks: `bun run typecheck` fails if the Payload
    // augmentation regresses. The runtime assertion only keeps bun happy.
    interface Product {
      id: number;
      title: string;
      _status?: 'draft' | 'published' | null;
    }

    const collection: CollectionConfig = {
      slug: 'products',
      fields: [
        {
          name: 'title',
          type: 'text',
          // @ts-expect-error unknown field-level key
          custom: { reversia: { asLable: true } },
        },
      ],
      custom: {
        reversia: {
          // A generated collection type narrows `doc`.
          isActive: ({ doc }: ReversiaIsActiveArgs<Product>) => doc._status === 'published',
        },
      },
    };

    const global: GlobalConfig = {
      slug: 'settings',
      fields: [],
      custom: {
        reversia: {
          // Unannotated: `doc` is inferred, no implicit any.
          isActive: async ({ doc, kind }) => kind === 'global' && Boolean(doc.enabled),
        },
      },
    };

    const typo: GlobalConfig = {
      slug: 'typo',
      fields: [],
      // @ts-expect-error unknown resource-level key
      custom: { reversia: { isActiv: () => true } },
    };

    const wrongReturn: GlobalConfig = {
      slug: 'wrong-return',
      fields: [],
      // @ts-expect-error isActive must return a boolean
      custom: { reversia: { isActive: () => 'yes' } },
    };

    const fn: ReversiaIsActive | undefined = collection.custom?.reversia?.isActive;
    expect(typeof fn).toBe('function');
    expect([global, typo, wrongReturn]).toHaveLength(3);
  });
});
