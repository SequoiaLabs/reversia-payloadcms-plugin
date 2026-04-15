/**
 * Structural path resolution for PayloadCMS fields.
 *
 * A localized field may be reached through a chain of object keys, array
 * containers, or blocks arrays. This module expresses that chain as a list of
 * segments and walks document data to produce concrete indexed paths such as
 * `items.0.title` or `body.2.title` (for a blocks field at position 2).
 */

export type PathSegment =
  | { kind: 'key'; name: string }
  | { kind: 'array'; name: string }
  | { kind: 'block'; name: string; blockSlug: string };

export interface ResolvedValue {
  indexedPath: string;
  value: unknown;
}

export function segmentsToTemplatePath(segments: readonly PathSegment[]): string {
  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === 'block') {
      parts.push(seg.name, seg.blockSlug);
    } else {
      parts.push(seg.name);
    }
  }

  return parts.join('.');
}

export function resolveValues(doc: unknown, segments: readonly PathSegment[]): ResolvedValue[] {
  const out: ResolvedValue[] = [];

  walk(doc, segments, 0, [], out);

  return out;
}

function walk(
  node: unknown,
  segments: readonly PathSegment[],
  i: number,
  pathParts: string[],
  out: ResolvedValue[],
): void {
  if (i === segments.length) {
    out.push({ indexedPath: pathParts.join('.'), value: node });
    return;
  }

  if (node === null || node === undefined || typeof node !== 'object') {
    return;
  }

  const seg = segments[i];

  if (seg.kind === 'key') {
    const next = (node as Record<string, unknown>)[seg.name];

    walk(next, segments, i + 1, [...pathParts, seg.name], out);

    return;
  }

  const arr = (node as Record<string, unknown>)[seg.name];

  if (!Array.isArray(arr)) {
    return;
  }

  for (let idx = 0; idx < arr.length; idx++) {
    const item = arr[idx];

    if (seg.kind === 'block') {
      if (
        !item ||
        typeof item !== 'object' ||
        (item as Record<string, unknown>).blockType !== seg.blockSlug
      ) {
        continue;
      }
    }

    walk(item, segments, i + 1, [...pathParts, seg.name, String(idx)], out);
  }
}

/**
 * Writes a value at an indexed path into a Payload-shaped update tree.
 *
 * When the path crosses into an array/blocks container, the array is lazily
 * materialised using structural hints from the corresponding source document
 * (e.g. preserving `id` and `blockType`) so Payload can persist the update
 * without dropping sibling items.
 */
export function setAtIndexedPath(
  target: Record<string, unknown>,
  sourceDoc: unknown,
  indexedPath: string,
  value: unknown,
): void {
  const parts = indexedPath.split('.');
  let tNode: unknown = target;
  let sNode: unknown = sourceDoc;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextKey);

    if (Array.isArray(tNode)) {
      const idx = Number(key);
      const srcItem = Array.isArray(sNode) ? sNode[idx] : undefined;

      if (tNode[idx] === undefined) {
        tNode[idx] = nextIsIndex ? [] : seedContainerFromSource(srcItem);
      }

      sNode = srcItem;
      tNode = tNode[idx];

      continue;
    }

    if (tNode && typeof tNode === 'object') {
      const obj = tNode as Record<string, unknown>;
      const srcChild =
        sNode && typeof sNode === 'object' ? (sNode as Record<string, unknown>)[key] : undefined;

      if (obj[key] === undefined) {
        if (nextIsIndex) {
          obj[key] = seedArrayFromSource(srcChild);
        } else {
          obj[key] = seedContainerFromSource(srcChild);
        }
      }

      sNode = srcChild;
      tNode = obj[key];
    }
  }

  const last = parts[parts.length - 1];

  if (Array.isArray(tNode)) {
    tNode[Number(last)] = value;
    return;
  }

  if (tNode && typeof tNode === 'object') {
    (tNode as Record<string, unknown>)[last] = value;
  }
}

function seedContainerFromSource(source: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const src = source as Record<string, unknown>;

    if (typeof src.id === 'string' || typeof src.id === 'number') {
      out.id = src.id;
    }

    if (typeof src.blockType === 'string') {
      out.blockType = src.blockType;
    }
  }

  return out;
}

/**
 * Reads the value at an indexed path (e.g. `items.0.title`) from an arbitrary
 * document, stepping through arrays by numeric index and objects by key.
 * Returns `undefined` for any missing segment.
 */
export function getAtIndexedPath(doc: unknown, indexedPath: string): unknown {
  const parts = indexedPath.split('.');
  let current: unknown = doc;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const idx = Number(part);

      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }

      current = current[idx];
      continue;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Checks whether a dot-separated indexed path can be produced by walking the
 * given segments. Array/block segments expect a numeric index in the indexed
 * path immediately after the container name.
 */
export function indexedPathMatchesSegments(
  indexedPath: string,
  segments: readonly PathSegment[],
): boolean {
  const parts = indexedPath.split('.');
  let p = 0;

  for (const seg of segments) {
    if (p >= parts.length) {
      return false;
    }

    if (seg.kind === 'key') {
      if (parts[p] !== seg.name) {
        return false;
      }

      p++;

      continue;
    }

    if (parts[p] !== seg.name) {
      return false;
    }

    p++;

    if (p >= parts.length) {
      return false;
    }

    if (!/^\d+$/.test(parts[p])) {
      return false;
    }

    p++;
  }

  return p === parts.length;
}

function seedArrayFromSource(source: unknown): unknown[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? seedContainerFromSource(item)
      : undefined,
  );
}
