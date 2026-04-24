import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Endpoint, getPayload, type Payload, type PayloadRequest } from 'payload';
import {
  type ConfirmResourcesSyncResponse,
  type InsertionResponse,
  type ResourceDefinition,
  type ResourceResponse,
  type ReversiaErrorResponse,
  ReversiaFieldBehavior,
  ReversiaFieldType,
  type SettingsResponse,
  type StreamResponse,
} from '../src/index.js';
import config, { TEST_API_KEY } from './payload.config.js';

let payload: Payload;

/**
 * Typed wrapper around a Payload custom endpoint invocation.
 *
 * The generic `T` is the body shape Reversia documents for the given endpoint
 * — use the interfaces exported from `src/index.ts` (`StreamResponse`,
 * `InsertionResponse`, etc.). `T` defaults to `ReversiaErrorResponse` for
 * endpoints where the test only asserts a 4xx status and never inspects the
 * body.
 */
async function callEndpoint<T = ReversiaErrorResponse>(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    searchParams?: Record<string, string>;
  } = {},
): Promise<{ status: number; json(): Promise<T>; raw: Response }> {
  const endpoint = payload.config.endpoints?.find(
    (e: Endpoint) => e.path === path && e.method === method,
  );

  if (!endpoint) {
    throw new Error(`Endpoint ${method.toUpperCase()} ${path} not found`);
  }

  const url = new URL(`http://localhost/api${path}`);

  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers(options.headers ?? {});

  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const req = {
    headers,
    payload,
    url: url.toString(),
    searchParams: url.searchParams,
    json: options.body ? async () => options.body : undefined,
    data: options.body ?? undefined,
  } as unknown as PayloadRequest;

  const response = await endpoint.handler(req);

  return {
    status: response.status,
    raw: response,
    async json(): Promise<T> {
      return (await response.json()) as T;
    },
  };
}

function withKey(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-API-Key': TEST_API_KEY, ...extra };
}

/**
 * Narrow `T | null | undefined` → `T` with a jest-style assertion so the
 * remainder of the test can access fields without optional chaining noise.
 */
function expectDefined<T>(
  value: T | null | undefined,
  message = 'expected value to be defined',
): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

interface SyncPendingDoc {
  id: string | number;
  resourceType: string;
  resourceId: string;
  updatedAt: string;
}

beforeAll(async () => {
  payload = await getPayload({ config });
});

afterAll(async () => {
  await payload.db.destroy?.();
});

describe('resources-definition', () => {
  test('hidden sync-pending collection exists', async () => {
    const res = await payload.find({ collection: 'reversia-sync-pending', limit: 0 });
    expect(res).toBeDefined();
  });

  test('rejects requests without API key', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition');
    expect(response.status).toBe(401);
  });

  test('returns definitions for posts, categories, and site-settings global', async () => {
    const response = await callEndpoint<ResourceDefinition[]>(
      'get',
      '/reversia/resources-definition',
      { headers: withKey() },
    );
    expect(response.status).toBe(200);

    const definitions = await response.json();
    const types = definitions.map((d: { type: string }) => d.type);

    expect(types).toContain('payloadcms:posts');
    expect(types).toContain('payloadcms:categories');
    expect(types).toContain('payloadcms:global:site-settings');
    expect(types).not.toContain('payloadcms:tags');
  });

  test('posts definition contains correct field config with enums', async () => {
    const response = await callEndpoint<ResourceDefinition[]>(
      'get',
      '/reversia/resources-definition',
      { headers: withKey() },
    );
    const definitions = await response.json();
    const posts = expectDefined(definitions.find((d) => d.type === 'payloadcms:posts'));

    expect(posts.configurationType).toBe('MULTIPLE');
    expect(posts.synchronizable).toBe(true);

    // title → asLabel: true (auto-detected)
    expect(posts.configuration.title).toEqual({ label: 'Title', asLabel: true });

    // content → type: JSON (inferred from richText)
    expect(posts.configuration.content.type).toBe(ReversiaFieldType.JSON);

    // slug → behavior: slug (from custom.reversia)
    expect(posts.configuration.slug.behavior).toBe(ReversiaFieldBehavior.SLUG);

    // externalUrl → type: LINK
    expect(posts.configuration.externalUrl.type).toBe(ReversiaFieldType.LINK);

    // ogImage → type: MEDIUM
    expect(posts.configuration.ogImage.type).toBe(ReversiaFieldType.MEDIUM);

    // metaDescription → plain text, no type
    expect(posts.configuration.metaDescription.type).toBeUndefined();

    // internalNotes is NOT localized → must not appear in configuration at all.
    expect(posts.configuration.internalNotes).toBeUndefined();
  });

  test('global definition has configurationType entity', async () => {
    const response = await callEndpoint<ResourceDefinition[]>(
      'get',
      '/reversia/resources-definition',
      { headers: withKey() },
    );
    const definitions = await response.json();
    const settings = expectDefined(
      definitions.find((d) => d.type === 'payloadcms:global:site-settings'),
    );

    expect(settings.configurationType).toBe('ENTITY');
    // Localized fields are present in the configuration map…
    expect(settings.configuration.siteTitle).toBeDefined();
    expect(settings.configuration.siteDescription).toBeDefined();
    // …while non-localized fields (analyticsId) never appear at all.
    expect(settings.configuration.analyticsId).toBeUndefined();
  });
});

describe('settings', () => {
  test('returns languages and default locale', async () => {
    const response = await callEndpoint<SettingsResponse>('get', '/reversia/settings', {
      headers: withKey(),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.platform).toBe('payloadcms');
    expect(data.defaultLocale).toBe('en');
    expect(data.languages).toEqual([
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
      { code: 'es', label: 'Spanish' },
    ]);
  });
});

describe('resources', () => {
  let postId: string;

  beforeAll(async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: {
        title: 'Hello World',
        slug: 'hello-world',
        externalUrl: 'https://example.com',
        ogImage: 'https://example.com/og.jpg',
        metaDescription: 'A test post',
        internalNotes: 'do not translate',
      },
    });
    postId = String(post.id);
  });

  test('lists resources with localized content', async () => {
    const response = await callEndpoint<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:posts' },
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.content.length).toBeGreaterThanOrEqual(1);

    const postsGroup = expectDefined(data.content.find((c) => c.type === 'payloadcms:posts'));

    const item = expectDefined(postsGroup.data.find((d) => d.id === postId));
    expect(item.content.title).toBe('Hello World');
    expect(item.content.slug).toBe('hello-world');
    expect(item.content.externalUrl).toBe('https://example.com');
    expect(item.content.internalNotes).toBeUndefined();
  });

  test('fetches single resource', async () => {
    const response = await callEndpoint<ResourceResponse>('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:posts', resourceId: postId },
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.id).toBe(postId);
    expect(data.content.title).toBe('Hello World');
  });

  test('returns 400 when resourceType missing', async () => {
    const response = await callEndpoint('get', '/reversia/resource', {
      headers: withKey(),
    });
    expect(response.status).toBe(400);
  });

  test('supports cursor-based pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await payload.create({
        collection: 'posts',
        locale: 'en',
        data: { title: `Pagination Post ${i}` },
      });
    }

    const res1 = await callEndpoint<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:posts', limit: '2' },
    });
    const data1 = await res1.json();
    expect(data1.content[0].data.length).toBe(2);
    expect(data1.cursor).not.toBeNull();

    const res2 = await callEndpoint<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: {
        types: 'payloadcms:posts',
        limit: '2',
        cursor: expectDefined(data1.cursor),
      },
    });
    const data2 = await res2.json();
    expect(data2.content[0].data.length).toBeGreaterThanOrEqual(1);

    const ids1 = data1.content[0].data.map((d) => d.id);
    const ids2 = data2.content[0].data.map((d) => d.id);
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap.length).toBe(0);
  });
});

describe('change tracking', () => {
  test('creates sync-pending record on document create', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Track Me' },
    });

    const pending = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: String(post.id) } },
        ],
      },
    });

    expect(pending.docs.length).toBe(1);
  });

  test('creates sync-pending record on document update', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Will Update' },
    });

    const initialPending = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: String(post.id) } },
        ],
      },
    });
    for (const doc of initialPending.docs) {
      await payload.delete({ collection: 'reversia-sync-pending', id: doc.id });
    }

    await payload.update({
      collection: 'posts',
      id: post.id,
      locale: 'en',
      data: { title: 'Updated Title' },
    });

    const pending = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: String(post.id) } },
        ],
      },
    });

    expect(pending.docs.length).toBe(1);
  });

  test('resources-sync returns pending resources', async () => {
    const response = await callEndpoint<StreamResponse>('get', '/reversia/resources-sync', {
      headers: withKey(),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.content.length).toBeGreaterThanOrEqual(1);

    const postsSync = expectDefined(data.content.find((c) => c.type === 'payloadcms:posts'));
    const identifiers = postsSync.data[0].content.identifiers as string[];
    expect(identifiers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('resources-insert', () => {
  let postId: string;

  beforeAll(async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: {
        title: 'English Title',
        slug: 'english-title',
        metaDescription: 'English description',
      },
    });
    postId = String(post.id);
  });

  test('inserts translation for target locale', async () => {
    const response = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:posts',
          id: postId,
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: {
            title: 'Titre Français',
            slug: 'titre-francais',
            metaDescription: 'Description française',
          },
        },
      ],
    });

    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.errors.length).toBe(0);
    expect(result[0]).toBeDefined();
    expect(result[0].type).toBe('payloadcms:posts');
    expect(result[0].id).toBe(postId);

    const doc = await payload.findByID({
      collection: 'posts',
      id: postId,
      locale: 'fr',
    });

    expect((doc as Record<string, unknown>).title).toBe('Titre Français');
    expect((doc as Record<string, unknown>).slug).toBe('titre-francais');
  });

  test('does not trigger sync-pending on insertion (reversiaInsertion context)', async () => {
    const before = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [{ resourceType: { equals: 'payloadcms:posts' } }, { resourceId: { equals: postId } }],
      },
    });
    for (const doc of before.docs) {
      await payload.delete({ collection: 'reversia-sync-pending', id: doc.id });
    }

    await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:posts',
          id: postId,
          sourceLocale: 'en',
          targetLocale: 'es',
          data: { title: 'Título Español' },
        },
      ],
    });

    const after = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [{ resourceType: { equals: 'payloadcms:posts' } }, { resourceId: { equals: postId } }],
      },
    });

    expect(after.docs.length).toBe(0);
  });

  test('rejects non-localized fields in insertion data', async () => {
    const response = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:posts',
          id: postId,
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: {
            title: 'Valid',
            internalNotes: 'Should be ignored',
          },
        },
      ],
    });

    expect(response.status).toBe(200);

    const doc = await payload.findByID({
      collection: 'posts',
      id: postId,
      locale: 'fr',
    });
    expect((doc as Record<string, unknown>).internalNotes).not.toBe('Should be ignored');
  });

  test('returns validation errors for malformed requests', async () => {
    const response = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        { type: 'payloadcms:posts' },
        { type: 'payloadcms:nonexistent', id: '1', targetLocale: 'fr', data: {} },
      ],
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('container-keyed insertion (group with localized leaf)', () => {
  test('writes JSON-pointer map back into the source-cloned container', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: {
        title: 'Nested Diff Source',
        seo: { metaTitle: 'EN Meta Title' },
      },
    });
    const postId = String(post.id);

    // Seed the target locale with a known previous value so the diff has
    // something to compare against. `title` is required on the collection so
    // we have to send it too when seeding the fr locale.
    await payload.update({
      collection: 'posts',
      id: postId,
      locale: 'fr',
      data: {
        title: 'Ancien Titre',
        seo: { metaTitle: 'Ancien Titre Meta' },
      },
    });

    const response = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:posts',
          id: postId,
          sourceLocale: 'en',
          targetLocale: 'fr',
          // New wire shape: data is keyed by top-level field name. Containers
          // ship a JSON-pointer map of translated leaves.
          data: {
            seo: JSON.stringify({ '/metaTitle': 'Nouveau Titre Meta' }),
          },
        },
      ],
    });

    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.errors).toEqual([]);
    // Diff is keyed by top-level field name (matches Reversia's
    // `translation.field` mapping).
    expect(result[0].diff.seo).toBeDefined();

    const doc = await payload.findByID({ collection: 'posts', id: postId, locale: 'fr' });
    expect(((doc as Record<string, unknown>).seo as Record<string, unknown>).metaTitle).toBe(
      'Nouveau Titre Meta',
    );
  });
});

describe('sync-queue change tracking (no data loss)', () => {
  test('re-editing a doc bumps the pending row updatedAt past any prior cursor', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Bump Me' },
    });
    const postId = String(post.id);

    const firstRound = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [{ resourceType: { equals: 'payloadcms:posts' } }, { resourceId: { equals: postId } }],
      },
    });
    expect(firstRound.docs.length).toBe(1);
    const firstUpdatedAt = new Date(
      (firstRound.docs[0] as unknown as SyncPendingDoc).updatedAt,
    ).getTime();

    // Wait one tick so the timestamp comparison is unambiguous under fast test
    // runners that can perform two operations within the same millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await payload.update({
      collection: 'posts',
      id: postId,
      locale: 'en',
      data: { title: 'Bumped Again' },
    });

    const secondRound = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [{ resourceType: { equals: 'payloadcms:posts' } }, { resourceId: { equals: postId } }],
      },
    });
    expect(secondRound.docs.length).toBe(1);
    const secondUpdatedAt = new Date(
      (secondRound.docs[0] as unknown as SyncPendingDoc).updatedAt,
    ).getTime();

    expect(secondUpdatedAt).toBeGreaterThan(firstUpdatedAt);
  });

  test('confirm with stale cursor preserves pending rows created after the cursor', async () => {
    // Clean slate.
    const existing = await payload.find({
      collection: 'reversia-sync-pending',
      limit: 1000,
    });
    for (const doc of existing.docs) {
      await payload.delete({ collection: 'reversia-sync-pending', id: doc.id });
    }

    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Initial Queue Entry' },
    });
    const postId = String(post.id);

    // Capture the cursor Reversia would see right now.
    const syncRes = await callEndpoint<StreamResponse>('get', '/reversia/resources-sync', {
      headers: withKey(),
      searchParams: { limit: '100' },
    });
    const syncData = await syncRes.json();
    const cursorAtPollTime = expectDefined(syncData.cursor);

    // Ensure the next update lands with a strictly greater timestamp even on
    // very fast test runners.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // User edits the same doc before Reversia confirms — the row is recreated
    // with a fresh updatedAt that must not be swept by the confirm call.
    await payload.update({
      collection: 'posts',
      id: postId,
      locale: 'en',
      data: { title: 'Edited During Translation' },
    });

    const confirmRes = await callEndpoint<ConfirmResourcesSyncResponse>(
      'post',
      '/reversia/confirm-resources-sync',
      {
        headers: withKey(),
        body: { cursor: cursorAtPollTime },
      },
    );
    expect(confirmRes.status).toBe(200);

    const remaining = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [{ resourceType: { equals: 'payloadcms:posts' } }, { resourceId: { equals: postId } }],
      },
    });
    // The post-cursor edit must survive — that's the data-loss fix.
    expect(remaining.docs.length).toBe(1);
  });

  test('confirm paginates through large batches (batched delete)', async () => {
    // Clean slate.
    const existing = await payload.find({
      collection: 'reversia-sync-pending',
      limit: 10000,
    });
    for (const doc of existing.docs) {
      await payload.delete({ collection: 'reversia-sync-pending', id: doc.id });
    }

    // Create enough entries to span more than one delete batch page.
    for (let i = 0; i < 12; i++) {
      await payload.create({
        collection: 'posts',
        locale: 'en',
        data: { title: `Batch ${i}` },
      });
    }

    const syncRes = await callEndpoint<StreamResponse>('get', '/reversia/resources-sync', {
      headers: withKey(),
      searchParams: { limit: '1000' },
    });
    const syncData = await syncRes.json();
    const batchCursor = expectDefined(syncData.cursor);

    const confirmRes = await callEndpoint<ConfirmResourcesSyncResponse>(
      'post',
      '/reversia/confirm-resources-sync',
      {
        headers: withKey(),
        body: { cursor: batchCursor },
      },
    );
    const confirmResult = await confirmRes.json();

    expect(confirmResult.success).toBe(true);
    expect(confirmResult.deleted).toBeGreaterThanOrEqual(12);

    const afterConfirm = await payload.find({
      collection: 'reversia-sync-pending',
      limit: 100,
    });
    // Nothing should remain at or below the cursor.
    expect(afterConfirm.docs.length).toBe(0);
  });
});

describe('confirm-resources-sync', () => {
  test('clears sync-pending records up to cursor', async () => {
    await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Confirm Test' },
    });

    const syncRes = await callEndpoint<StreamResponse>('get', '/reversia/resources-sync', {
      headers: withKey(),
      searchParams: { limit: '100' },
    });
    const syncData = await syncRes.json();

    if (syncData.cursor) {
      const confirmRes = await callEndpoint<ConfirmResourcesSyncResponse>(
        'post',
        '/reversia/confirm-resources-sync',
        {
          headers: withKey(),
          body: { cursor: syncData.cursor },
        },
      );

      expect(confirmRes.status).toBe(200);
      const result = await confirmRes.json();
      expect(result.success).toBe(true);
      expect(typeof result.deleted).toBe('number');
    }
  });
});

describe('globals', () => {
  test('fetches global resource', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      locale: 'en',
      data: {
        siteTitle: 'My Site',
        siteDescription: 'A great site',
      },
    });

    const response = await callEndpoint<ResourceResponse>('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:global:site-settings' },
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.id).toBe('site-settings');
    expect(data.content.siteTitle).toBe('My Site');
    expect(data.content.siteDescription).toBe('A great site');
    expect(data.content.analyticsId).toBeUndefined();
  });

  test('inserts translation for global', async () => {
    const response = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:global:site-settings',
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: {
            siteTitle: 'Mon Site',
            siteDescription: 'Un super site',
          },
        },
      ],
    });

    expect(response.status).toBe(200);

    const doc = await payload.findGlobal({
      slug: 'site-settings',
      locale: 'fr',
    });

    expect((doc as Record<string, unknown>).siteTitle).toBe('Mon Site');
    expect((doc as Record<string, unknown>).siteDescription).toBe('Un super site');
  });
});

describe('locale fallback does not prevent seeding required fields', () => {
  // Reproduces the bug: Payload's locale fallback makes previousDoc return
  // the default-locale value for empty target-locale fields. Our seeding
  // logic used to see a non-null value and skip, but the actual DB slot was
  // empty — so Payload's required validation rejected the update.
  //
  // The fix: fetch previousDoc with `fallbackLocale: false`.

  test('inserts into an empty target locale when fallback is enabled and required fields exist', async () => {
    // Create a post in EN only (the default locale).
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Fallback Test EN' },
    });
    const postId = String(post.id);

    // FR locale has NOTHING — but with `fallback: true` in the config,
    // reading at locale=fr returns the EN title as a fallback. If our
    // previousDoc fetch doesn't disable fallback, seeding thinks FR already
    // has a title and skips it → required validation fails.
    const response = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:posts',
          id: postId,
          sourceLocale: 'en',
          targetLocale: 'fr',
          // Only send slug — NOT title. Title is required but not in this
          // batch (it was "sent in another request" per the real-world case).
          data: { slug: 'test-fallback-fr' },
        },
      ],
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    // The insertion must succeed — title was seeded from EN source because
    // our previousDoc fetch uses fallbackLocale:false and sees FR title as
    // null, triggering the seed.
    expect(result.errors).toEqual([]);
    expect(result[0]).toBeDefined();
    expect(result[0].type).toBe('payloadcms:posts');

    // Verify the FR locale actually has the seeded title.
    const frDoc = await payload.findByID({
      collection: 'posts',
      id: postId,
      locale: 'fr',
      fallbackLocale: false as const,
    });
    // Title was seeded from EN source (not translated, but present so
    // validation passes).
    expect((frDoc as Record<string, unknown>).title).toBe('Fallback Test EN');
    // Slug was the translated value from Reversia.
    expect((frDoc as Record<string, unknown>).slug).toBe('test-fallback-fr');
  });
});

describe('globals streaming', () => {
  // Regression: the /reversia/resources endpoint used to iterate collections
  // only and silently drop every global's content. Reversia would see the
  // resource-definition for a global but never receive its content bucket.
  test('streams global content alongside collections', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      locale: 'en',
      data: { siteTitle: 'Streamed Site', siteDescription: 'Streamed desc' },
    });

    const response = await callEndpoint<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:global:site-settings' },
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    const bucket = expectDefined(
      data.content.find((c) => c.type === 'payloadcms:global:site-settings'),
    );
    expect(bucket.data.length).toBe(1);
    expect(bucket.data[0].id).toBe('site-settings');
    expect(bucket.data[0].content.siteTitle).toBe('Streamed Site');
    expect(bucket.data[0].content.siteDescription).toBe('Streamed desc');
  });

  // Regression: `array > row (unnamed) > localized text` is the footer-links
  // shape. Traversal must walk into the row without adding a path segment and
  // still emit the inner localized leaf as a container atom.
  test('streams localized leaves nested inside array > row containers', async () => {
    await payload.updateGlobal({
      slug: 'footer-links',
      locale: 'en',
      data: {
        links: [
          { name: 'About', url: '/about' },
          { name: 'Contact', url: '/contact' },
        ],
      },
    });

    const response = await callEndpoint<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:global:footer-links' },
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    const bucket = expectDefined(
      data.content.find((c) => c.type === 'payloadcms:global:footer-links'),
    );
    const links = bucket.data[0].content.links as string;
    expect(typeof links).toBe('string');
    const atoms = JSON.parse(links) as Record<string, string>;
    // One pointer per localized leaf — `/0/name` and `/1/name`. `url` is not
    // localized and must not appear.
    expect(atoms['/0/name']).toBe('About');
    expect(atoms['/1/name']).toBe('Contact');
    expect(Object.keys(atoms).some((k) => k.endsWith('/url'))).toBe(false);
  });
});

describe('unique-constraint collision handling', () => {
  // Regression: Reversia may translate two docs' source titles to the same
  // target string (common for proper nouns, short phrases, numeric suffixes).
  // Before the fix, the second insert threw `ValidationError: title.en: Value
  // must be unique` and the whole item failed. The fix pre-checks unique
  // scalars and drops the colliding field from `updateData`, letting the
  // insert succeed as a no-op on that field.
  test('drops a colliding unique scalar instead of failing the whole item', async () => {
    const docA = await payload.create({
      collection: 'unique-docs',
      locale: 'en',
      data: { title: 'Source A' },
    });
    const docB = await payload.create({
      collection: 'unique-docs',
      locale: 'en',
      data: { title: 'Source B' },
    });

    // First insert: FR translation for docA — should land normally.
    const first = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:unique-docs',
          id: String(docA.id),
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: { title: 'Collision' },
        },
      ],
    });
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.errors).toEqual([]);

    const frDocA = await payload.findByID({
      collection: 'unique-docs',
      id: docA.id,
      locale: 'fr',
      fallbackLocale: false as const,
    });
    expect((frDocA as Record<string, unknown>).title).toBe('Collision');

    // Second insert: FR translation for docB with the SAME title as docA's FR
    // slot. The unique pre-check should drop the title from updateData.
    // Because `title` is the only translatable field on this collection, the
    // endpoint records "all fields skipped" and moves on — it does NOT throw.
    const second = await callEndpoint<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:unique-docs',
          id: String(docB.id),
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: { title: 'Collision' },
        },
      ],
    });
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    // The item must be reported as a non-fatal skip, not a raw ValidationError.
    expect(secondJson.errors.length).toBe(1);
    expect(secondJson.errors[0]).toContain('unique-constraint');
    expect(secondJson.errors[0]).not.toContain('ValidationError');

    // docB's FR title remained empty (no collision poisoned the slot).
    const frDocB = await payload.findByID({
      collection: 'unique-docs',
      id: docB.id,
      locale: 'fr',
      fallbackLocale: false as const,
    });
    expect((frDocB as Record<string, unknown>).title).toBeFalsy();

    // docA's FR title is untouched.
    const frDocACheck = await payload.findByID({
      collection: 'unique-docs',
      id: docA.id,
      locale: 'fr',
      fallbackLocale: false as const,
    });
    expect((frDocACheck as Record<string, unknown>).title).toBe('Collision');
  });
});

describe('auth', () => {
  test('all GET endpoints reject without API key', async () => {
    const endpoints = [
      '/reversia/resources-definition',
      '/reversia/resources',
      '/reversia/resources-sync',
      '/reversia/settings',
    ];

    for (const path of endpoints) {
      const response = await callEndpoint('get', path);
      expect(response.status).toBe(401);
    }
  });

  test('rejects wrong API key', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition', {
      headers: { 'X-API-Key': 'wrong-key' },
    });
    expect(response.status).toBe(401);
  });
});
