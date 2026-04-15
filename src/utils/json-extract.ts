/**
 * Key-driven extraction for richText / json field values.
 *
 * Walks a JSON value and emits a flat map keyed by JSON Pointer (RFC 6901):
 *   { "/root/children/0/text": "Hello" }
 *
 * Only leaf strings whose *key path* (object keys only, array indices skipped)
 * matches one of the compiled glob patterns are emitted.
 *
 * Pattern syntax:
 *   text            — bare key; sugar for `**.text` (match at any depth)
 *   root.foo        — anchored path from the root
 *   foo.*.bar       — `*` matches a single key segment
 *   foo.**.bar      — `**` matches zero or more key segments
 */

type Segment = { kind: 'key'; value: string } | { kind: 'star' } | { kind: 'globstar' };

export type CompiledPattern = readonly Segment[];

export function compilePattern(pattern: string): CompiledPattern {
  const parts = pattern.split('.').filter((p) => p.length > 0);

  if (parts.length === 1 && parts[0] !== '*' && parts[0] !== '**') {
    return [{ kind: 'globstar' }, { kind: 'key', value: parts[0] }];
  }

  return parts.map((p): Segment => {
    if (p === '*') {
      return { kind: 'star' };
    }

    if (p === '**') {
      return { kind: 'globstar' };
    }

    return { kind: 'key', value: p };
  });
}

/** Classic two-pointer glob match with `**` backtracking. */
function matchPattern(segs: CompiledPattern, path: readonly string[]): boolean {
  let i = 0;
  let j = 0;
  let starI = -1;
  let starJ = 0;

  while (j < path.length) {
    const seg = segs[i];

    if (seg?.kind === 'globstar') {
      starI = i;
      starJ = j;
      i++;

      continue;
    }

    if (seg && (seg.kind === 'star' || (seg.kind === 'key' && seg.value === path[j]))) {
      i++;
      j++;

      continue;
    }

    if (starI !== -1) {
      i = starI + 1;
      starJ++;
      j = starJ;

      continue;
    }

    return false;
  }

  while (i < segs.length && segs[i].kind === 'globstar') {
    i++;
  }

  return i === segs.length;
}

export interface KeyMatcher {
  matches(keyPath: readonly string[]): boolean;
}

export function compileKeyMatcher(patterns: readonly string[]): KeyMatcher {
  const compiled = patterns.map(compilePattern);

  return {
    matches(keyPath) {
      if (keyPath.length === 0) {
        return false;
      }

      for (const p of compiled) {
        if (matchPattern(p, keyPath)) {
          return true;
        }
      }

      return false;
    },
  };
}

function encodePointerSegment(seg: string | number): string {
  if (typeof seg === 'number') {
    return String(seg);
  }

  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decodePointerSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encodePointer(path: readonly (string | number)[]): string {
  let out = '';

  for (const seg of path) {
    out = `${out}/${encodePointerSegment(seg)}`;
  }

  return out;
}

function decodePointer(pointer: string): string[] {
  if (pointer === '') {
    return [];
  }

  if (pointer[0] !== '/') {
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  }

  return pointer.slice(1).split('/').map(decodePointerSegment);
}

export function extractByKeys(value: unknown, matcher: KeyMatcher): Record<string, string> {
  const out: Record<string, string> = {};
  const locPath: (string | number)[] = [];
  const keyPath: string[] = [];

  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (matcher.matches(keyPath)) {
        out[encodePointer(locPath)] = node;
      }

      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        locPath.push(i);
        visit(node[i]);
        locPath.pop();
      }

      return;
    }

    if (node !== null && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        locPath.push(k);
        keyPath.push(k);
        visit((node as Record<string, unknown>)[k]);
        keyPath.pop();
        locPath.pop();
      }
    }
  };

  visit(value);

  return out;
}

/**
 * Deep-clones `sourceValue` and writes each translated string at its pointer.
 * Missing targets are skipped silently — the source tree may have drifted.
 */
export function applyByKeys(sourceValue: unknown, translations: Record<string, string>): unknown {
  if (sourceValue === null || typeof sourceValue !== 'object') {
    return sourceValue;
  }

  const cloned = structuredClone(sourceValue);

  for (const pointer of Object.keys(translations)) {
    writeAtPointer(cloned, decodePointer(pointer), translations[pointer]);
  }

  return cloned;
}

function writeAtPointer(root: unknown, segments: readonly string[], value: string): void {
  if (segments.length === 0) {
    return;
  }

  let current: unknown = root;

  for (let i = 0; i < segments.length - 1; i++) {
    current = stepInto(current, segments[i]);

    if (current === undefined) {
      return;
    }
  }

  const last = segments[segments.length - 1];

  if (Array.isArray(current)) {
    const idx = Number(last);

    if (Number.isInteger(idx) && idx >= 0 && idx < current.length) {
      current[idx] = value;
    }

    return;
  }

  if (current !== null && typeof current === 'object' && last in current) {
    (current as Record<string, unknown>)[last] = value;
  }
}

function stepInto(node: unknown, segment: string): unknown {
  if (Array.isArray(node)) {
    const idx = Number(segment);

    if (!Number.isInteger(idx)) {
      return undefined;
    }

    return node[idx];
  }

  if (node !== null && typeof node === 'object') {
    return (node as Record<string, unknown>)[segment];
  }

  return undefined;
}

export const DEFAULT_RICHTEXT_KEYS = ['text', 'url', 'alt'] as const;
