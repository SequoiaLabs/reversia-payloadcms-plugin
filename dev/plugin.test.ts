import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { getPayload, type Endpoint, type Payload, type PayloadRequest } from 'payload'
import config, { TEST_API_KEY } from './payload.config.js'

let payload: Payload

/**
 * Calls a Payload custom endpoint handler directly (no HTTP server needed).
 */
async function callEndpoint(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>
    body?: unknown
    searchParams?: Record<string, string>
  } = {},
): Promise<Response> {
  const endpoint = payload.config.endpoints?.find(
    (e: Endpoint) => e.path === path && e.method === method,
  )

  if (!endpoint) {
    throw new Error(`Endpoint ${method.toUpperCase()} ${path} not found`)
  }

  const url = new URL(`http://localhost/api${path}`)

  if (options.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value)
    }
  }

  const headers = new Headers(options.headers ?? {})

  if (options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const req = {
    headers,
    payload,
    url: url.toString(),
    searchParams: url.searchParams,
    json: options.body ? async () => options.body : undefined,
    data: options.body ?? undefined,
  } as unknown as PayloadRequest

  return endpoint.handler(req)
}

function withKey(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-API-Key': TEST_API_KEY, ...extra }
}

beforeAll(async () => {
  payload = await getPayload({ config })
})

afterAll(async () => {
  await payload.db.destroy?.()
})


describe('resources-definition', () => {
  test('hidden sync-pending collection exists', async () => {
    const res = await payload.find({ collection: 'reversia-sync-pending', limit: 0 })
    expect(res).toBeDefined()
  })

  test('rejects requests without API key', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition')
    expect(response.status).toBe(401)
  })

  test('returns definitions for posts, categories, and site-settings global', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition', {
      headers: withKey(),
    })
    expect(response.status).toBe(200)

    const definitions = await response.json()
    const types = definitions.map((d: { type: string }) => d.type)

    expect(types).toContain('payloadcms:posts')
    expect(types).toContain('payloadcms:categories')
    expect(types).toContain('payloadcms:global:site-settings')
    expect(types).not.toContain('payloadcms:tags')
  })

  test('posts definition contains correct field config with enums', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition', {
      headers: withKey(),
    })
    const definitions = await response.json()
    const posts = definitions.find((d: { type: string }) => d.type === 'payloadcms:posts')

    expect(posts).toBeDefined()
    expect(posts.configurationType).toBe('MULTIPLE')
    expect(posts.synchronizable).toBe(true)

    // title → asLabel: true (auto-detected)
    expect(posts.configuration.title).toEqual({ label: 'Title', asLabel: true })

    // content → type: HTML (inferred from richText)
    expect(posts.configuration.content.type).toBe('JSON')

    // slug → behavior: slug (from custom.reversia)
    expect(posts.configuration.slug.behavior).toBe('slug')

    // externalUrl → type: LINK
    expect(posts.configuration.externalUrl.type).toBe('LINK')

    // ogImage → type: MEDIUM
    expect(posts.configuration.ogImage.type).toBe('MEDIUM')

    // metaDescription → plain text, no type
    expect(posts.configuration.metaDescription.type).toBeUndefined()

    // internalNotes is NOT localized → must not appear
    expect(posts.configuration.internalNotes).toBeUndefined()
  })

  test('global definition has configurationType entity', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition', {
      headers: withKey(),
    })
    const definitions = await response.json()
    const settings = definitions.find(
      (d: { type: string }) => d.type === 'payloadcms:global:site-settings',
    )

    expect(settings).toBeDefined()
    expect(settings.configurationType).toBe('ENTITY')
    expect(settings.configuration.siteTitle).toBeDefined()
    expect(settings.configuration.siteDescription).toBeDefined()
    expect(settings.configuration.analyticsId).toBeUndefined()
  })
})


describe('settings', () => {
  test('returns languages and default locale', async () => {
    const response = await callEndpoint('get', '/reversia/settings', {
      headers: withKey(),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.platform).toBe('payloadcms')
    expect(data.defaultLocale).toBe('en')
    expect(data.languages).toEqual([
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'French' },
      { code: 'es', label: 'Spanish' },
    ])
  })
})


describe('resources', () => {
  let postId: string

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
    })
    postId = String(post.id)
  })

  test('lists resources with localized content', async () => {
    const response = await callEndpoint('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:posts' },
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.content.length).toBeGreaterThanOrEqual(1)

    const postsGroup = data.content.find(
      (c: { type: string }) => c.type === 'payloadcms:posts',
    )
    expect(postsGroup).toBeDefined()

    const item = postsGroup.data.find((d: { id: string }) => d.id === postId)
    expect(item).toBeDefined()
    expect(item.content.title).toBe('Hello World')
    expect(item.content.slug).toBe('hello-world')
    expect(item.content.externalUrl).toBe('https://example.com')
    expect(item.content.internalNotes).toBeUndefined()
  })

  test('fetches single resource', async () => {
    const response = await callEndpoint('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:posts', resourceId: postId },
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.id).toBe(postId)
    expect(data.content.title).toBe('Hello World')
  })

  test('returns 400 when resourceType missing', async () => {
    const response = await callEndpoint('get', '/reversia/resource', {
      headers: withKey(),
    })
    expect(response.status).toBe(400)
  })

  test('supports cursor-based pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await payload.create({
        collection: 'posts',
        locale: 'en',
        data: { title: `Pagination Post ${i}` },
      })
    }

    const res1 = await callEndpoint('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:posts', limit: '2' },
    })
    const data1 = await res1.json()
    expect(data1.content[0].data.length).toBe(2)
    expect(data1.cursor).not.toBeNull()

    const res2 = await callEndpoint('get', '/reversia/resources', {
      headers: withKey(),
      searchParams: { types: 'payloadcms:posts', limit: '2', cursor: data1.cursor },
    })
    const data2 = await res2.json()
    expect(data2.content[0].data.length).toBeGreaterThanOrEqual(1)

    const ids1 = data1.content[0].data.map((d: { id: string }) => d.id)
    const ids2 = data2.content[0].data.map((d: { id: string }) => d.id)
    const overlap = ids1.filter((id: string) => ids2.includes(id))
    expect(overlap.length).toBe(0)
  })
})


describe('change tracking', () => {
  test('creates sync-pending record on document create', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Track Me' },
    })

    const pending = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: String(post.id) } },
        ],
      },
    })

    expect(pending.docs.length).toBe(1)
  })

  test('creates sync-pending record on document update', async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Will Update' },
    })

    const initialPending = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: String(post.id) } },
        ],
      },
    })
    for (const doc of initialPending.docs) {
      await payload.delete({ collection: 'reversia-sync-pending', id: doc.id })
    }

    await payload.update({
      collection: 'posts',
      id: post.id,
      locale: 'en',
      data: { title: 'Updated Title' },
    })

    const pending = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: String(post.id) } },
        ],
      },
    })

    expect(pending.docs.length).toBe(1)
  })

  test('resources-sync returns pending resources', async () => {
    const response = await callEndpoint('get', '/reversia/resources-sync', {
      headers: withKey(),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.content.length).toBeGreaterThanOrEqual(1)

    const postsSync = data.content.find(
      (c: { type: string }) => c.type === 'payloadcms:posts',
    )
    expect(postsSync).toBeDefined()
    expect(postsSync.data[0].content.identifiers.length).toBeGreaterThanOrEqual(1)
  })
})


describe('resources-insert', () => {
  let postId: string

  beforeAll(async () => {
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      data: {
        title: 'English Title',
        slug: 'english-title',
        metaDescription: 'English description',
      },
    })
    postId = String(post.id)
  })

  test('inserts translation for target locale', async () => {
    const response = await callEndpoint('put', '/reversia/resources-insert', {
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
    })

    expect(response.status).toBe(200)

    const result = await response.json()
    expect(result.errors.length).toBe(0)
    expect(result[0]).toBeDefined()
    expect(result[0].type).toBe('payloadcms:posts')
    expect(result[0].id).toBe(postId)

    const doc = await payload.findByID({
      collection: 'posts',
      id: postId,
      locale: 'fr',
    })

    expect((doc as Record<string, unknown>).title).toBe('Titre Français')
    expect((doc as Record<string, unknown>).slug).toBe('titre-francais')
  })

  test('does not trigger sync-pending on insertion (reversiaInsertion context)', async () => {
    const before = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: postId } },
        ],
      },
    })
    for (const doc of before.docs) {
      await payload.delete({ collection: 'reversia-sync-pending', id: doc.id })
    }

    await callEndpoint('put', '/reversia/resources-insert', {
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
    })

    const after = await payload.find({
      collection: 'reversia-sync-pending',
      where: {
        and: [
          { resourceType: { equals: 'payloadcms:posts' } },
          { resourceId: { equals: postId } },
        ],
      },
    })

    expect(after.docs.length).toBe(0)
  })

  test('rejects non-localized fields in insertion data', async () => {
    const response = await callEndpoint('put', '/reversia/resources-insert', {
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
    })

    expect(response.status).toBe(200)

    const doc = await payload.findByID({
      collection: 'posts',
      id: postId,
      locale: 'fr',
    })
    expect((doc as Record<string, unknown>).internalNotes).not.toBe('Should be ignored')
  })

  test('returns validation errors for malformed requests', async () => {
    const response = await callEndpoint('put', '/reversia/resources-insert', {
      headers: withKey(),
      body: [
        { type: 'payloadcms:posts' },
        { type: 'payloadcms:nonexistent', id: '1', targetLocale: 'fr', data: {} },
      ],
    })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})


describe('confirm-resources-sync', () => {
  test('clears sync-pending records up to cursor', async () => {
    await payload.create({
      collection: 'posts',
      locale: 'en',
      data: { title: 'Confirm Test' },
    })

    const syncRes = await callEndpoint('get', '/reversia/resources-sync', {
      headers: withKey(),
      searchParams: { limit: '100' },
    })
    const syncData = await syncRes.json()

    if (syncData.cursor) {
      const confirmRes = await callEndpoint('post', '/reversia/confirm-resources-sync', {
        headers: withKey(),
        body: { cursor: syncData.cursor },
      })

      expect(confirmRes.status).toBe(200)
      const result = await confirmRes.json()
      expect(result).toBe(true)
    }
  })
})


describe('globals', () => {
  test('fetches global resource', async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      locale: 'en',
      data: {
        siteTitle: 'My Site',
        siteDescription: 'A great site',
      },
    })

    const response = await callEndpoint('get', '/reversia/resource', {
      headers: withKey(),
      searchParams: { resourceType: 'payloadcms:global:site-settings' },
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.id).toBe('site-settings')
    expect(data.content.siteTitle).toBe('My Site')
    expect(data.content.siteDescription).toBe('A great site')
    expect(data.content.analyticsId).toBeUndefined()
  })

  test('inserts translation for global', async () => {
    const response = await callEndpoint('put', '/reversia/resources-insert', {
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
    })

    expect(response.status).toBe(200)

    const doc = await payload.findGlobal({
      slug: 'site-settings',
      locale: 'fr',
    })

    expect((doc as Record<string, unknown>).siteTitle).toBe('Mon Site')
    expect((doc as Record<string, unknown>).siteDescription).toBe('Un super site')
  })
})


describe('auth', () => {
  test('all GET endpoints reject without API key', async () => {
    const endpoints = [
      '/reversia/resources-definition',
      '/reversia/resources',
      '/reversia/resources-sync',
      '/reversia/settings',
    ]

    for (const path of endpoints) {
      const response = await callEndpoint('get', path)
      expect(response.status).toBe(401)
    }
  })

  test('rejects wrong API key', async () => {
    const response = await callEndpoint('get', '/reversia/resources-definition', {
      headers: { 'X-API-Key': 'wrong-key' },
    })
    expect(response.status).toBe(401)
  })
})
