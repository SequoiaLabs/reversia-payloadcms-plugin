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
import { createResourcesInsertEndpoint } from '../src/endpoints/resources-insert.js';
import type {
  InsertionResponse,
  ResourceResponse,
  ReversiaPluginConfig,
  StreamResponse,
} from '../src/index.js';
import { type EndpointCallOptions, expectDefined, invokeEndpoint, withKey } from './helpers.js';
import config, { TEST_API_KEY } from './payload.config.js';

/**
 * Draft-awareness tests.
 *
 * The dev config registers the plugin WITHOUT `useDrafts`, so
 * `payload.config.endpoints` exercises the legacy path. For the `useDrafts`
 * path we build the same endpoint factories by hand with a second plugin
 * config and point them at the same Payload instance — the endpoints only
 * need `req.payload` plus the collection/global configs.
 *
 * `articles` and `announcement` have `versions.drafts` enabled; `posts` does
 * not, and is used to prove the flag is a no-op for entities without drafts.
 */

let payload: Payload;
let draftEndpoints: Endpoint[];
let legacyEndpoints: Endpoint[];

type Doc = Record<string, unknown>;

function buildEndpoints(pluginConfig: ReversiaPluginConfig): Endpoint[] {
  const collectionsMap = new Map<string, CollectionConfig>();
  const globalsMap = new Map<string, GlobalConfig>();

  for (const collection of payload.config.collections) {
    if (collection.slug === 'articles' || collection.slug === 'posts') {
      collectionsMap.set(collection.slug, collection as unknown as CollectionConfig);
    }
  }

  for (const global of payload.config.globals) {
    if (global.slug === 'announcement' || global.slug === 'site-settings') {
      globalsMap.set(global.slug, global as unknown as GlobalConfig);
    }
  }

  return [
    createResourcesEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourceEndpoint(pluginConfig, collectionsMap, globalsMap),
    createResourcesInsertEndpoint(pluginConfig, collectionsMap, globalsMap),
  ];
}

function callDrafts<T>(method: string, path: string, options: EndpointCallOptions = {}) {
  return invokeEndpoint<T>(draftEndpoints, payload, method, path, options);
}

function callLegacy<T>(method: string, path: string, options: EndpointCallOptions = {}) {
  return invokeEndpoint<T>(legacyEndpoints, payload, method, path, options);
}

async function readArticle(id: string, options: { locale: string; draft?: boolean }): Promise<Doc> {
  const doc = await payload.findByID({
    collection: 'articles',
    id,
    locale: options.locale as 'en',
    draft: options.draft ?? false,
    fallbackLocale: false,
    depth: 0,
  });
  return doc as Doc;
}

async function readAnnouncement(options: { locale: string; draft?: boolean }): Promise<Doc> {
  const doc = await payload.findGlobal({
    slug: 'announcement',
    locale: options.locale as 'en',
    draft: options.draft ?? false,
    fallbackLocale: false,
    depth: 0,
  });
  return doc as Doc;
}

async function createPublishedArticle(title: string, summary?: string): Promise<string> {
  const doc = await payload.create({
    collection: 'articles',
    locale: 'en',
    data: { title, summary, _status: 'published' },
  });
  return String(doc.id);
}

async function saveArticleDraft(id: string, locale: string, data: Doc): Promise<void> {
  await payload.update({
    collection: 'articles',
    id,
    locale: locale as 'en',
    draft: true,
    data,
  });
}

async function insertArticleTranslation(
  call: typeof callDrafts,
  id: string,
  targetLocale: string,
  data: Doc,
): Promise<InsertionResponse> {
  const response = await call<InsertionResponse>('put', '/reversia/resources-insert', {
    headers: withKey(),
    body: [{ type: 'payloadcms:articles', id, sourceLocale: 'en', targetLocale, data }],
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.errors).toEqual([]);
  return result;
}

async function countSyncPending(resourceType: string, resourceId: string): Promise<number> {
  const res = await payload.find({
    collection: 'reversia-sync-pending',
    where: {
      and: [{ resourceType: { equals: resourceType } }, { resourceId: { equals: resourceId } }],
    },
    limit: 100,
  });
  return res.docs.length;
}

async function clearSyncPending(resourceType: string, resourceId: string): Promise<void> {
  const res = await payload.find({
    collection: 'reversia-sync-pending',
    where: {
      and: [{ resourceType: { equals: resourceType } }, { resourceId: { equals: resourceId } }],
    },
    limit: 100,
  });
  for (const doc of res.docs) {
    await payload.delete({ collection: 'reversia-sync-pending', id: doc.id });
  }
}

beforeAll(async () => {
  // `plugin.test.ts` runs first in the same process and destroys its DB
  // client in `afterAll`. `getPayload` caches instances by `key`, so ask for
  // a separate one instead of inheriting the torn-down default instance.
  payload = await getPayload({ config, key: 'drafts' });
  draftEndpoints = buildEndpoints({ apiKey: TEST_API_KEY, useDrafts: true });
  legacyEndpoints = buildEndpoints({ apiKey: TEST_API_KEY });
});

afterAll(async () => {
  await payload.db.destroy?.();
});

describe('useDrafts — reading collections', () => {
  let articleId: string;

  beforeAll(async () => {
    articleId = await createPublishedArticle('Launch day', 'We ship today');
    await saveArticleDraft(articleId, 'en', {
      title: 'Launch day (draft)',
      summary: 'We ship tomorrow',
    });
  });

  test('single resource returns the pending draft when useDrafts is on', async () => {
    const response = await callDrafts<ResourceResponse>('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:articles', resourceId: articleId },
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.content.title).toBe('Launch day (draft)');
    expect(body.content.summary).toBe('We ship tomorrow');
    expect(body.label).toBe('Launch day (draft)');
  });

  test('single resource returns the published document when useDrafts is off', async () => {
    const response = await callLegacy<ResourceResponse>('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:articles', resourceId: articleId },
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.content.title).toBe('Launch day');
    expect(body.content.summary).toBe('We ship today');
  });

  test('resources listing returns pending drafts when useDrafts is on', async () => {
    const response = await callDrafts<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:articles' },
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    const group = expectDefined(body.content.find((c) => c.type === 'payloadcms:articles'));
    const item = expectDefined(group.data.find((d) => d.id === articleId));

    expect(item.content.title).toBe('Launch day (draft)');
  });

  test('resources listing returns published documents when useDrafts is off', async () => {
    const response = await callLegacy<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:articles' },
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    const group = expectDefined(body.content.find((c) => c.type === 'payloadcms:articles'));
    const item = expectDefined(group.data.find((d) => d.id === articleId));

    expect(item.content.title).toBe('Launch day');
  });

  test('resources listing paginates drafts by document id', async () => {
    const first = await callDrafts<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:articles', limit: '1' },
    });
    const firstBody = await first.json();
    const firstGroup = expectDefined(
      firstBody.content.find((c) => c.type === 'payloadcms:articles'),
    );
    expect(firstGroup.data.length).toBe(1);
    expect(firstBody.cursor).not.toBeNull();

    const second = await callDrafts<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: {
        types: 'payloadcms:articles',
        limit: '1',
        cursor: expectDefined(firstBody.cursor),
      },
    });
    const secondBody = await second.json();
    const secondGroup = secondBody.content.find((c) => c.type === 'payloadcms:articles');

    // Only one article exists in this describe block at this point, so the
    // second page must be empty — and, crucially, must not re-emit the first
    // document (which would happen if the cursor were compared against the
    // version row id rather than the parent document id).
    if (secondGroup) {
      expect(secondGroup.data.map((d) => d.id)).not.toContain(articleId);
    }
  });
});

describe('useDrafts — insertion while the source draft is being edited', () => {
  let articleId: string;

  beforeAll(async () => {
    articleId = await createPublishedArticle('Release notes', 'Stable build');
    await saveArticleDraft(articleId, 'en', {
      title: 'Release notes (draft)',
      summary: 'Beta build',
    });
    await clearSyncPending('payloadcms:articles', articleId);
  });

  test('writes the translation into the draft and leaves the published document untouched', async () => {
    await insertArticleTranslation(callDrafts, articleId, 'fr', {
      title: 'Notes de version',
      summary: 'Version bêta',
    });

    // Draft carries the translation…
    const draftFr = await readArticle(articleId, { locale: 'fr', draft: true });
    expect(draftFr.title).toBe('Notes de version');
    expect(draftFr.summary).toBe('Version bêta');
    expect(draftFr._status).toBe('draft');

    // …the source-locale draft the editor is working on is preserved…
    const draftEn = await readArticle(articleId, { locale: 'en', draft: true });
    expect(draftEn.title).toBe('Release notes (draft)');
    expect(draftEn.summary).toBe('Beta build');

    // …and nothing reached the published document in either locale.
    const publishedEn = await readArticle(articleId, { locale: 'en' });
    expect(publishedEn.title).toBe('Release notes');
    expect(publishedEn.summary).toBe('Stable build');

    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title ?? null).toBeNull();
    expect(publishedFr.summary ?? null).toBeNull();
  });

  test('does not enqueue a sync-pending entry for a draft insertion', async () => {
    expect(await countSyncPending('payloadcms:articles', articleId)).toBe(0);
  });

  test('editor keeps editing the source draft afterwards: translation survives, nothing publishes', async () => {
    await saveArticleDraft(articleId, 'en', { title: 'Release notes (draft v2)' });

    const draftEn = await readArticle(articleId, { locale: 'en', draft: true });
    expect(draftEn.title).toBe('Release notes (draft v2)');

    const draftFr = await readArticle(articleId, { locale: 'fr', draft: true });
    expect(draftFr.title).toBe('Notes de version');
    expect(draftFr.summary).toBe('Version bêta');

    const publishedEn = await readArticle(articleId, { locale: 'en' });
    expect(publishedEn.title).toBe('Release notes');

    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title ?? null).toBeNull();
  });

  test('a second insertion updates the draft translation without publishing', async () => {
    await insertArticleTranslation(callDrafts, articleId, 'fr', {
      title: 'Notes de version (v2)',
    });

    const draftFr = await readArticle(articleId, { locale: 'fr', draft: true });
    expect(draftFr.title).toBe('Notes de version (v2)');
    // Untouched field keeps its earlier draft translation.
    expect(draftFr.summary).toBe('Version bêta');

    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title ?? null).toBeNull();
  });

  test('the diff reported by insertion is computed against the draft, not the published doc', async () => {
    const result = await insertArticleTranslation(callDrafts, articleId, 'fr', {
      title: 'Notes de version (v3)',
    });

    expect(result[0].diff.title).toBe('Notes de version (v2)');
  });
});

describe('useDrafts — publishing', () => {
  test('publishing the document publishes every locale, including the inserted translation', async () => {
    const articleId = await createPublishedArticle('Roadmap', 'Q1 goals');
    await saveArticleDraft(articleId, 'en', { title: 'Roadmap (draft)', summary: 'Q2 goals' });
    await insertArticleTranslation(callDrafts, articleId, 'fr', {
      title: 'Feuille de route',
      summary: 'Objectifs T2',
    });

    // Editor hits "Publish" from the English tab.
    await payload.update({
      collection: 'articles',
      id: articleId,
      locale: 'en',
      data: { _status: 'published' },
    });

    const publishedEn = await readArticle(articleId, { locale: 'en' });
    expect(publishedEn.title).toBe('Roadmap (draft)');
    expect(publishedEn._status).toBe('published');

    // Payload publishes the whole document, so the French draft translation
    // goes live with it.
    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title).toBe('Feuille de route');
    expect(publishedFr.summary).toBe('Objectifs T2');
  });

  test('publishSpecificLocale publishes only that locale; the translation stays in draft', async () => {
    const articleId = await createPublishedArticle('Changelog', 'Initial');
    await saveArticleDraft(articleId, 'en', { title: 'Changelog (draft)', summary: 'Second' });
    await insertArticleTranslation(callDrafts, articleId, 'fr', {
      title: 'Journal des modifications',
      summary: 'Deuxième',
    });

    await payload.update({
      collection: 'articles',
      id: articleId,
      locale: 'en',
      publishSpecificLocale: 'en',
      data: { _status: 'published' },
    });

    const publishedEn = await readArticle(articleId, { locale: 'en' });
    expect(publishedEn.title).toBe('Changelog (draft)');

    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title ?? null).toBeNull();

    const draftFr = await readArticle(articleId, { locale: 'fr', draft: true });
    expect(draftFr.title).toBe('Journal des modifications');
    expect(draftFr.summary).toBe('Deuxième');
  });

  test('inserting into a published document with no pending draft creates a draft', async () => {
    const articleId = await createPublishedArticle('Pricing', 'Per seat');
    await insertArticleTranslation(callDrafts, articleId, 'fr', {
      title: 'Tarifs',
      summary: 'Par siège',
    });

    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title ?? null).toBeNull();

    const draftFr = await readArticle(articleId, { locale: 'fr', draft: true });
    expect(draftFr.title).toBe('Tarifs');
    expect(draftFr._status).toBe('draft');

    // The source locale is carried over unchanged into the new draft.
    const draftEn = await readArticle(articleId, { locale: 'en', draft: true });
    expect(draftEn.title).toBe('Pricing');

    const versions = await payload.findVersions({
      collection: 'articles',
      where: { parent: { equals: articleId } },
      sort: '-updatedAt',
      limit: 1,
    });
    const latest = expectDefined(versions.docs[0]) as unknown as { version: Doc };
    expect(latest.version._status).toBe('draft');
  });
});

describe('useDrafts — entities without drafts', () => {
  test('is a no-op for collections without versions.drafts', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Plain post', slug: 'plain-post' },
    });
    const postId = String(post.id);

    const response = await callDrafts<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:posts',
          id: postId,
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: { title: 'Billet simple' },
        },
      ],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).errors).toEqual([]);

    const doc = (await payload.findByID({
      collection: 'posts',
      id: postId,
      locale: 'fr',
      fallbackLocale: false,
    })) as Doc;
    expect(doc.title).toBe('Billet simple');
  });
});

describe('useDrafts off — legacy behaviour on draft-enabled collections', () => {
  test('insertion writes straight to the published document, publishing the pending source draft with it', async () => {
    const articleId = await createPublishedArticle('Legacy', 'Old');
    await saveArticleDraft(articleId, 'en', { title: 'Legacy (draft)', summary: 'New' });

    await insertArticleTranslation(callLegacy, articleId, 'fr', {
      title: 'Héritage',
      summary: 'Nouveau',
    });

    const publishedFr = await readArticle(articleId, { locale: 'fr' });
    expect(publishedFr.title).toBe('Héritage');

    // Payload bases every non-draft update on the latest version, so the
    // unpublished English edits are pushed to the published document as a
    // side effect. This is the behaviour `useDrafts: true` exists to avoid.
    const publishedEn = await readArticle(articleId, { locale: 'en' });
    expect(publishedEn.title).toBe('Legacy (draft)');
    expect(publishedEn.summary).toBe('New');
  });
});

describe('useDrafts — per-resource overrides in enabledCollections / enabledGlobals', () => {
  let articleId: string;

  beforeAll(async () => {
    articleId = await createPublishedArticle('Scoped', 'Published copy');
    await saveArticleDraft(articleId, 'en', { title: 'Scoped (draft)' });
    await payload.updateGlobal({
      slug: 'announcement',
      locale: 'en',
      data: { headline: 'Scoped news', _status: 'published' },
    });
    await payload.updateGlobal({
      slug: 'announcement',
      locale: 'en',
      draft: true,
      data: { headline: 'Scoped news (draft)' },
    });
  });

  async function readTitles(endpoints: Endpoint[]) {
    const article = await invokeEndpoint<ResourceResponse>(
      endpoints,
      payload,
      'get',
      '/reversia/resource',
      {
        headers: withKey(),
        searchParams: { resourceType: 'payloadcms:articles', resourceId: articleId },
      },
    );
    const announcement = await invokeEndpoint<ResourceResponse>(
      endpoints,
      payload,
      'get',
      '/reversia/resource',
      {
        headers: withKey(),
        searchParams: { resourceType: 'payloadcms:global:announcement' },
      },
    );
    return {
      article: (await article.json()).content.title,
      announcement: (await announcement.json()).content.headline,
    };
  }

  test('{ slug, useDrafts: true } enables drafts for that resource only', async () => {
    const endpoints = buildEndpoints({
      apiKey: TEST_API_KEY,
      enabledCollections: [{ slug: 'articles', useDrafts: true }],
      enabledGlobals: ['announcement'],
    });

    expect(await readTitles(endpoints)).toEqual({
      article: 'Scoped (draft)',
      announcement: 'Scoped news',
    });
  });

  test('{ slug, useDrafts: false } opts a resource out of a root useDrafts: true', async () => {
    const endpoints = buildEndpoints({
      apiKey: TEST_API_KEY,
      useDrafts: true,
      enabledCollections: [{ slug: 'articles', useDrafts: false }],
      enabledGlobals: [{ slug: 'announcement' }],
    });

    expect(await readTitles(endpoints)).toEqual({
      article: 'Scoped',
      announcement: 'Scoped news (draft)',
    });
  });

  test('per-resource useDrafts also governs the insertion write', async () => {
    const endpoints = buildEndpoints({
      apiKey: TEST_API_KEY,
      enabledCollections: ['articles'],
      enabledGlobals: [{ slug: 'announcement', useDrafts: true }],
    });

    const response = await invokeEndpoint<InsertionResponse>(
      endpoints,
      payload,
      'put',
      '/reversia/resources-insert',
      {
        headers: withKey(),
        body: [
          {
            type: 'payloadcms:global:announcement',
            id: 'announcement',
            sourceLocale: 'en',
            targetLocale: 'es',
            data: { headline: 'Noticias' },
          },
        ],
      },
    );
    expect((await response.json()).errors).toEqual([]);

    expect((await readAnnouncement({ locale: 'es', draft: true })).headline).toBe('Noticias');
    expect((await readAnnouncement({ locale: 'es' })).headline ?? null).toBeNull();
  });

  test('reversiaPlugin accepts object entries when filtering exposed resources', async () => {
    const { reversiaPlugin } = await import('../src/index.js');
    const raw = {
      collections: [
        { slug: 'a', fields: [{ name: 't', type: 'text' as const, localized: true }] },
        { slug: 'b', fields: [{ name: 't', type: 'text' as const, localized: true }] },
      ],
      globals: [
        { slug: 'g', fields: [{ name: 't', type: 'text' as const, localized: true }] },
        { slug: 'h', fields: [{ name: 't', type: 'text' as const, localized: true }] },
      ],
    } as unknown as Parameters<ReturnType<typeof reversiaPlugin>>[0];

    const out = reversiaPlugin({
      apiKey: TEST_API_KEY,
      enabledCollections: [{ slug: 'a' as 'posts', useDrafts: true }],
      enabledGlobals: ['h'],
    })(raw);

    const hooked = (out.collections ?? [])
      .filter((c) => (c.hooks?.afterChange ?? []).length > 0)
      .map((c) => c.slug);
    expect(hooked).toEqual(['a']);
  });
});

describe('useDrafts — globals', () => {
  beforeAll(async () => {
    await payload.updateGlobal({
      slug: 'announcement',
      locale: 'en',
      data: { headline: 'Big news', _status: 'published' },
    });
    await payload.updateGlobal({
      slug: 'announcement',
      locale: 'en',
      draft: true,
      data: { headline: 'Big news (draft)' },
    });
  });

  test('single resource returns the pending draft when useDrafts is on', async () => {
    const drafts = await callDrafts<ResourceResponse>('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:global:announcement' },
    });
    expect((await drafts.json()).content.headline).toBe('Big news (draft)');

    const legacy = await callLegacy<ResourceResponse>('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:global:announcement' },
    });
    expect((await legacy.json()).content.headline).toBe('Big news');
  });

  test('resources listing returns the pending draft when useDrafts is on', async () => {
    const response = await callDrafts<StreamResponse>('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:global:announcement' },
    });
    const body = await response.json();
    const group = expectDefined(
      body.content.find((c) => c.type === 'payloadcms:global:announcement'),
    );
    expect(group.data[0]?.content.headline).toBe('Big news (draft)');
  });

  test('insertion writes into the global draft and leaves the published global untouched', async () => {
    const response = await callDrafts<InsertionResponse>('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        {
          type: 'payloadcms:global:announcement',
          id: 'announcement',
          sourceLocale: 'en',
          targetLocale: 'fr',
          data: { headline: 'Grande nouvelle' },
        },
      ],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).errors).toEqual([]);

    const draftFr = await readAnnouncement({ locale: 'fr', draft: true });
    expect(draftFr.headline).toBe('Grande nouvelle');

    const draftEn = await readAnnouncement({ locale: 'en', draft: true });
    expect(draftEn.headline).toBe('Big news (draft)');

    const publishedEn = await readAnnouncement({ locale: 'en' });
    expect(publishedEn.headline).toBe('Big news');

    const publishedFr = await readAnnouncement({ locale: 'fr' });
    expect(publishedFr.headline ?? null).toBeNull();
  });

  test('publishing the global publishes the inserted translation', async () => {
    await payload.updateGlobal({
      slug: 'announcement',
      locale: 'en',
      data: { _status: 'published' },
    });

    const publishedEn = await readAnnouncement({ locale: 'en' });
    expect(publishedEn.headline).toBe('Big news (draft)');

    const publishedFr = await readAnnouncement({ locale: 'fr' });
    expect(publishedFr.headline).toBe('Grande nouvelle');
  });
});
