import type { Endpoint, Payload, PayloadRequest } from 'payload';
import type { ReversiaErrorResponse } from '../src/index.js';
import { TEST_API_KEY } from './payload.config.js';

export interface EndpointCallOptions {
  headers?: Record<string, string>;
  body?: unknown;
  searchParams?: Record<string, string>;
}

export interface EndpointCallResult<T> {
  status: number;
  json(): Promise<T>;
  raw: Response;
}

/**
 * Invokes a Payload custom endpoint handler directly, bypassing the HTTP
 * layer. `endpoints` is the list to search (typically
 * `payload.config.endpoints`, or a hand-built list when a test needs a
 * plugin configuration that differs from the one registered in the dev
 * config).
 *
 * The generic `T` is the body shape Reversia documents for the given endpoint
 * — use the interfaces exported from `src/index.ts` (`StreamResponse`,
 * `InsertionResponse`, etc.). `T` defaults to `ReversiaErrorResponse` for
 * endpoints where the test only asserts a 4xx status and never inspects the
 * body.
 */
export async function invokeEndpoint<T = ReversiaErrorResponse>(
  endpoints: readonly Endpoint[],
  payload: Payload,
  method: string,
  path: string,
  options: EndpointCallOptions = {},
): Promise<EndpointCallResult<T>> {
  const endpoint = endpoints.find((e: Endpoint) => e.path === path && e.method === method);

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

export function withKey(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-API-Key': TEST_API_KEY, ...extra };
}

/**
 * Narrow `T | null | undefined` → `T` with a jest-style assertion so the
 * remainder of the test can access fields without optional chaining noise.
 */
export function expectDefined<T>(
  value: T | null | undefined,
  message = 'expected value to be defined',
): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}
