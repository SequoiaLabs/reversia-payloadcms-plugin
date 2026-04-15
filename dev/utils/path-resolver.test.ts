import { describe, expect, test } from 'bun:test';
import {
  getAtIndexedPath,
  indexedPathMatchesSegments,
  type PathSegment,
  resolveValues,
  setAtIndexedPath,
} from '../../src/utils/path-resolver.js';

describe('resolveValues', () => {
  test('returns a single entry for scalar object path', () => {
    const segments: PathSegment[] = [{ kind: 'key', name: 'title' }];
    expect(resolveValues({ title: 'Hello' }, segments)).toEqual([
      { indexedPath: 'title', value: 'Hello' },
    ]);
  });

  test('iterates array containers and emits indexed paths', () => {
    const segments: PathSegment[] = [
      { kind: 'array', name: 'items' },
      { kind: 'key', name: 'title' },
    ];
    const doc = { items: [{ title: 'A' }, { title: 'B' }] };
    expect(resolveValues(doc, segments)).toEqual([
      { indexedPath: 'items.0.title', value: 'A' },
      { indexedPath: 'items.1.title', value: 'B' },
    ]);
  });

  test('filters blocks by blockType', () => {
    const segments: PathSegment[] = [
      { kind: 'block', name: 'body', blockSlug: 'hero' },
      { kind: 'key', name: 'title' },
    ];
    const doc = {
      body: [
        { blockType: 'hero', title: 'HeroA' },
        { blockType: 'callout', title: 'CalloutA' },
        { blockType: 'hero', title: 'HeroB' },
      ],
    };
    expect(resolveValues(doc, segments)).toEqual([
      { indexedPath: 'body.0.title', value: 'HeroA' },
      { indexedPath: 'body.2.title', value: 'HeroB' },
    ]);
  });

  test('returns empty when array is missing or wrong shape', () => {
    const segments: PathSegment[] = [
      { kind: 'array', name: 'items' },
      { kind: 'key', name: 'title' },
    ];
    expect(resolveValues({ items: null }, segments)).toEqual([]);
    expect(resolveValues({}, segments)).toEqual([]);
  });
});

describe('indexedPathMatchesSegments', () => {
  test('matches scalar path', () => {
    const segments: PathSegment[] = [{ kind: 'key', name: 'title' }];
    expect(indexedPathMatchesSegments('title', segments)).toBe(true);
    expect(indexedPathMatchesSegments('other', segments)).toBe(false);
  });

  test('matches array-indexed path', () => {
    const segments: PathSegment[] = [
      { kind: 'array', name: 'items' },
      { kind: 'key', name: 'title' },
    ];
    expect(indexedPathMatchesSegments('items.0.title', segments)).toBe(true);
    expect(indexedPathMatchesSegments('items.42.title', segments)).toBe(true);
    expect(indexedPathMatchesSegments('items.title', segments)).toBe(false);
    expect(indexedPathMatchesSegments('items.0.other', segments)).toBe(false);
  });

  test('rejects non-numeric index positions', () => {
    const segments: PathSegment[] = [
      { kind: 'array', name: 'items' },
      { kind: 'key', name: 'title' },
    ];
    expect(indexedPathMatchesSegments('items.hero.title', segments)).toBe(false);
  });
});

describe('setAtIndexedPath', () => {
  test('writes scalar keys', () => {
    const target: Record<string, unknown> = {};
    setAtIndexedPath(target, {}, 'title', 'Hi');
    expect(target).toEqual({ title: 'Hi' });
  });

  test('writes into arrays preserving source metadata (id/blockType)', () => {
    const target: Record<string, unknown> = {};
    const source = {
      body: [
        { id: 'a', blockType: 'hero', title: 'en-A' },
        { id: 'b', blockType: 'hero', title: 'en-B' },
      ],
    };

    setAtIndexedPath(target, source, 'body.0.title', 'fr-A');
    setAtIndexedPath(target, source, 'body.1.title', 'fr-B');

    expect(target).toEqual({
      body: [
        { id: 'a', blockType: 'hero', title: 'fr-A' },
        { id: 'b', blockType: 'hero', title: 'fr-B' },
      ],
    });
  });
});

describe('getAtIndexedPath', () => {
  test('reads through arrays and objects', () => {
    const doc = { items: [{ title: 'A' }, { title: 'B' }] };
    expect(getAtIndexedPath(doc, 'items.1.title')).toBe('B');
    expect(getAtIndexedPath(doc, 'items.5.title')).toBeUndefined();
    expect(getAtIndexedPath(doc, 'missing.path')).toBeUndefined();
  });
});
