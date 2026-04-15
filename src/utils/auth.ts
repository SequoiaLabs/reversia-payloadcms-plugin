import { timingSafeEqual } from 'node:crypto';
import type { PayloadRequest } from 'payload';

export function validateApiKey(req: PayloadRequest, expectedKey: string): boolean {
  if (typeof expectedKey !== 'string' || expectedKey.length === 0) {
    return false;
  }

  const headerKey = req.headers.get('x-api-key');
  const queryKey = req.searchParams.get('apiKey');
  const providedKey = headerKey ?? queryKey;

  if (typeof providedKey !== 'string' || providedKey.length === 0) {
    return false;
  }

  return constantTimeEquals(providedKey, expectedKey);
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');

  if (aBuf.length !== bBuf.length) {
    // Still consume a comparison on a pair of equal-length buffers so callers
    // cannot distinguish "wrong length" from "wrong contents" via timing.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }

  return timingSafeEqual(aBuf, bBuf);
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: 'Invalid API key' }, { status: 401 });
}
