import type { Cursor } from '../types.js';

/**
 * Opaque cursor encoding. Uses JSON in base64url so the delimiter concern
 * (types or ids containing `|`) is eliminated.
 */
export function encodeCursor(type: string, id: string): string {
  return Buffer.from(JSON.stringify({ type, id }), 'utf-8').toString('base64url');
}

export function decodeCursor(cursorString: string | null | undefined): Cursor | null {
  if (!cursorString) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursorString, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as unknown;

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>).type !== 'string' ||
      typeof (parsed as Record<string, unknown>).id !== 'string'
    ) {
      return null;
    }

    const { type, id } = parsed as { type: string; id: string };

    if (type.length === 0 || id.length === 0) {
      return null;
    }

    return { type, id };
  } catch {
    return null;
  }
}
