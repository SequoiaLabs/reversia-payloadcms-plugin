import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { triggerCrawl } from '../src/index.js';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function makeFetch(responder: (call: CapturedCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: CapturedCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function getHeader(init: RequestInit, name: string): string | null {
  const raw = init.headers;
  if (!raw) {
    return null;
  }
  if (raw instanceof Headers) {
    return raw.get(name);
  }
  if (Array.isArray(raw)) {
    const match = raw.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return match ? match[1] : null;
  }
  const record = raw as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? record[key] : null;
}

function parseBody(init: RequestInit): unknown {
  if (typeof init.body !== 'string') {
    throw new Error('expected JSON string body');
  }
  return JSON.parse(init.body);
}

const PREVIOUS_ENV = process.env.REVERSIA_API_URL;

beforeEach(() => {
  delete process.env.REVERSIA_API_URL;
});

afterEach(() => {
  if (PREVIOUS_ENV === undefined) {
    delete process.env.REVERSIA_API_URL;
  } else {
    process.env.REVERSIA_API_URL = PREVIOUS_ENV;
  }
});

describe('triggerCrawl', () => {
  test('throws when apiKey is missing', async () => {
    expect(triggerCrawl({ apiKey: '' })).rejects.toThrow(/\[reversia\] apiKey is required/);
  });

  test('throws when apiKey is not a string', async () => {
    expect(
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime validation
      triggerCrawl({ apiKey: undefined as any }),
    ).rejects.toThrow(/\[reversia\] apiKey is required/);
  });

  test('POSTs to <baseUrl>/projects/trigger-crawl with Bearer auth and JSON headers', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    const result = await triggerCrawl({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.test',
      fetch: fetchMock,
    });

    expect(result).toEqual({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.test/projects/trigger-crawl');
    expect(calls[0].init.method).toBe('POST');
    expect(getHeader(calls[0].init, 'Authorization')).toBe('Bearer sk-test');
    expect(getHeader(calls[0].init, 'Content-Type')).toBe('application/json');
    expect(getHeader(calls[0].init, 'Accept')).toBe('application/json');
  });

  test('omits types and noCache from the body when not provided', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fetchMock,
    });

    expect(parseBody(calls[0].init)).toEqual({});
  });

  test('prefixes collection and global slugs with `payloadcms:`', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      types: ['articles', 'site-settings'],
      fetch: fetchMock,
    });

    expect(parseBody(calls[0].init)).toEqual({
      types: ['payloadcms:articles', 'payloadcms:site-settings'],
    });
  });

  test('drops empty strings from types and omits the field when nothing remains', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      types: ['', ''],
      fetch: fetchMock,
    });

    expect(parseBody(calls[0].init)).toEqual({});
  });

  test('sends noCache: true only when explicitly truthy', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      noCache: true,
      fetch: fetchMock,
    });

    expect(parseBody(calls[0].init)).toEqual({ noCache: true });
  });

  test('omits noCache when explicitly false', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      noCache: false,
      fetch: fetchMock,
    });

    expect(parseBody(calls[0].init)).toEqual({});
  });

  test('strips trailing slashes from baseUrl', async () => {
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test///',
      fetch: fetchMock,
    });

    expect(calls[0].url).toBe('https://api.example.test/projects/trigger-crawl');
  });

  test('honors REVERSIA_API_URL env var when baseUrl is omitted', async () => {
    process.env.REVERSIA_API_URL = 'https://env.example.test';
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({ apiKey: 'k', fetch: fetchMock });

    expect(calls[0].url).toBe('https://env.example.test/projects/trigger-crawl');
  });

  test('explicit baseUrl wins over REVERSIA_API_URL env var', async () => {
    process.env.REVERSIA_API_URL = 'https://env.example.test';
    const { fetch: fetchMock, calls } = makeFetch(() => jsonResponse({ success: true }));

    await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://override.example.test',
      fetch: fetchMock,
    });

    expect(calls[0].url).toBe('https://override.example.test/projects/trigger-crawl');
  });

  test('throws with a descriptive prefix on non-2xx responses', async () => {
    const { fetch: fetchMock } = makeFetch(
      () =>
        new Response(JSON.stringify({ message: 'unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    expect(
      triggerCrawl({
        apiKey: 'bad',
        baseUrl: 'https://api.example.test',
        fetch: fetchMock,
      }),
    ).rejects.toThrow(/\[reversia\] trigger-crawl failed: 401 Unauthorized/);
  });

  test('returns success: false when the response body says so', async () => {
    const { fetch: fetchMock } = makeFetch(() => jsonResponse({ success: false }));

    const result = await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fetchMock,
    });

    expect(result).toEqual({ success: false });
  });

  test('treats unparseable 2xx body as success', async () => {
    const { fetch: fetchMock } = makeFetch(
      () =>
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    );

    const result = await triggerCrawl({
      apiKey: 'k',
      baseUrl: 'https://api.example.test',
      fetch: fetchMock,
    });

    expect(result).toEqual({ success: true });
  });
});
