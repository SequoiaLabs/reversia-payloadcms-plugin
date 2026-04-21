/**
 * Structural traversal for "container" fields.
 *
 * In the per-top-level-field model, every translatable resource entry is a
 * single top-level field. Scalars ship as plain strings. Containers (groups,
 * arrays, blocks, richText, json) ship as a JSON-stringified map of
 *   { <jsonPointer>: <translatableString> }
 * where each pointer addresses one atomic translatable leaf inside the
 * container's value.
 *
 * `LeafSegment` describes how to navigate from a container's *value* down to
 * one of its localized leaves. Unlike absolute paths from the document root,
 * an `iterate` segment means "the current node is an array, iterate it" —
 * because the container's value IS the array we're already inside.
 */

export type LeafSegment =
  | { kind: 'key'; name: string }
  | { kind: 'iterate' }
  | { kind: 'iterateBlock'; blockSlug: string };

export interface LeafLocation {
  /** RFC 6901 JSON Pointer string from the container's value root. */
  pointer: string;
  /** Decoded pointer parts (object keys / numeric indices). */
  pointerParts: string[];
  /** Resolved value at that location. */
  value: unknown;
}

export function resolveLeafLocations(
  containerValue: unknown,
  segments: readonly LeafSegment[],
): LeafLocation[] {
  const out: LeafLocation[] = [];
  walk(containerValue, segments, 0, [], out);
  return out;
}

function walk(
  node: unknown,
  segs: readonly LeafSegment[],
  i: number,
  parts: string[],
  out: LeafLocation[],
): void {
  if (i === segs.length) {
    out.push({ pointer: encodePointer(parts), pointerParts: parts.slice(), value: node });
    return;
  }

  if (node === null || node === undefined) {
    return;
  }

  const seg = segs[i];

  if (seg.kind === 'key') {
    if (typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    const next = (node as Record<string, unknown>)[seg.name];
    walk(next, segs, i + 1, [...parts, seg.name], out);
    return;
  }

  if (seg.kind === 'iterate') {
    if (!Array.isArray(node)) {
      return;
    }
    for (let idx = 0; idx < node.length; idx++) {
      walk(node[idx], segs, i + 1, [...parts, String(idx)], out);
    }
    return;
  }

  if (seg.kind === 'iterateBlock') {
    if (!Array.isArray(node)) {
      return;
    }
    for (let idx = 0; idx < node.length; idx++) {
      const item = node[idx];
      if (
        item &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).blockType === seg.blockSlug
      ) {
        walk(item, segs, i + 1, [...parts, String(idx)], out);
      }
    }
  }
}

export function encodePointer(parts: readonly string[]): string {
  if (parts.length === 0) {
    return '';
  }

  let out = '';

  for (const p of parts) {
    out += `/${encodePointerSegment(p)}`;
  }

  return out;
}

export function decodePointer(pointer: string): string[] {
  if (pointer === '' || pointer === '/') {
    return pointer === '/' ? [''] : [];
  }

  if (pointer[0] !== '/') {
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  }

  return pointer.slice(1).split('/').map(decodePointerSegment);
}

function encodePointerSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decodePointerSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Concatenate a parent pointer with a child pointer (already encoded).
 * `''` is the empty pointer (root). Either side may be empty.
 */
export function joinPointers(parent: string, child: string): string {
  if (parent === '') {
    return child;
  }

  if (child === '') {
    return parent;
  }

  return `${parent}${child}`;
}

/**
 * Writes a string at the location addressed by `pointer` inside `target`.
 * Creates intermediate objects/arrays when traversal hits null/undefined,
 * preserving any pre-existing structure encountered along the way.
 */
export function writeAtPointer(target: unknown, pointer: string, value: string): unknown {
  const parts = decodePointer(pointer);

  if (parts.length === 0) {
    return value;
  }

  let root: unknown = target;

  if (root === null || root === undefined) {
    root = /^\d+$/.test(parts[0]) ? [] : {};
  }

  let current: unknown = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextKey);

    if (Array.isArray(current)) {
      const idx = Number(key);

      if (current[idx] === null || current[idx] === undefined) {
        current[idx] = nextIsIndex ? [] : {};
      }

      current = current[idx];
      continue;
    }

    if (current && typeof current === 'object') {
      const obj = current as Record<string, unknown>;

      if (obj[key] === null || obj[key] === undefined) {
        obj[key] = nextIsIndex ? [] : {};
      }

      current = obj[key];
    }
  }

  const last = parts[parts.length - 1];

  if (Array.isArray(current)) {
    current[Number(last)] = value;
  } else if (current && typeof current === 'object') {
    (current as Record<string, unknown>)[last] = value;
  }

  return root;
}

/**
 * Deep-clones the source-locale container value and overlays each translation
 * at its addressed pointer. When `containerSource` is missing, builds a sparse
 * tree from the pointers — best-effort fallback so the platform still receives
 * translated values for any leaves Reversia did send.
 */
export function applyTranslationsToContainer(
  containerSource: unknown,
  translations: Record<string, string>,
): unknown {
  let root: unknown =
    containerSource === undefined || containerSource === null
      ? null
      : structuredClone(containerSource);

  for (const [pointer, value] of Object.entries(translations)) {
    root = writeAtPointer(root, pointer, value);
  }

  return root;
}
