import { describe, expect, test } from 'bun:test';
import {
  applyTranslationsToContainer,
  decodePointer,
  encodePointer,
  joinPointers,
  type LeafSegment,
  resolveLeafLocations,
  writeAtPointer,
} from '../../src/utils/path-resolver.js';

describe('encodePointer / decodePointer', () => {
  test('round-trips object keys and numeric indices', () => {
    expect(encodePointer(['items', '0', 'title'])).toBe('/items/0/title');
    expect(decodePointer('/items/0/title')).toEqual(['items', '0', 'title']);
  });

  test('escapes ~ and / per RFC 6901', () => {
    expect(encodePointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
    expect(decodePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  test('empty pointer means root', () => {
    expect(encodePointer([])).toBe('');
    expect(decodePointer('')).toEqual([]);
  });
});

describe('joinPointers', () => {
  test('handles empty parent / child', () => {
    expect(joinPointers('', '/x/y')).toBe('/x/y');
    expect(joinPointers('/a', '')).toBe('/a');
    expect(joinPointers('', '')).toBe('');
  });

  test('concatenates non-empty', () => {
    expect(joinPointers('/a', '/b/c')).toBe('/a/b/c');
  });
});

describe('resolveLeafLocations', () => {
  test('walks `key` segments through an object', () => {
    const segments: LeafSegment[] = [{ kind: 'key', name: 'metaTitle' }];
    const locations = resolveLeafLocations({ metaTitle: 'Hello' }, segments);
    expect(locations).toEqual([
      { pointer: '/metaTitle', pointerParts: ['metaTitle'], value: 'Hello' },
    ]);
  });

  test('iterates `iterate` segments through an array', () => {
    const segments: LeafSegment[] = [{ kind: 'iterate' }, { kind: 'key', name: 'title' }];
    const items = [{ title: 'A' }, { title: 'B' }];
    const locations = resolveLeafLocations(items, segments);
    expect(locations.map((l) => l.pointer)).toEqual(['/0/title', '/1/title']);
    expect(locations.map((l) => l.value)).toEqual(['A', 'B']);
  });

  test('iterateBlock filters by blockType', () => {
    const segments: LeafSegment[] = [
      { kind: 'iterateBlock', blockSlug: 'hero' },
      { kind: 'key', name: 'title' },
    ];
    const body = [
      { blockType: 'hero', title: 'HeroA' },
      { blockType: 'callout', title: 'CalloutA' },
      { blockType: 'hero', title: 'HeroB' },
    ];
    const locations = resolveLeafLocations(body, segments);
    expect(locations).toEqual([
      { pointer: '/0/title', pointerParts: ['0', 'title'], value: 'HeroA' },
      { pointer: '/2/title', pointerParts: ['2', 'title'], value: 'HeroB' },
    ]);
  });

  test('empty segments return root', () => {
    const locations = resolveLeafLocations({ a: 1 }, []);
    expect(locations).toEqual([{ pointer: '', pointerParts: [], value: { a: 1 } }]);
  });
});

describe('writeAtPointer', () => {
  test('writes a leaf value into an existing tree', () => {
    const tree: { items: Array<{ title: string }> } = { items: [{ title: 'A' }, { title: 'B' }] };
    writeAtPointer(tree, '/items/1/title', 'Z');
    expect(tree.items[1].title).toBe('Z');
  });

  test('materialises objects and arrays when traversal hits null', () => {
    const tree = writeAtPointer(null, '/items/0/title', 'A');
    expect(tree).toEqual({ items: [{ title: 'A' }] });
  });
});

describe('applyTranslationsToContainer', () => {
  test('clones source and overlays multiple translations', () => {
    const source = {
      items: [
        { id: 'a', title: 'Hello', description: 'World' },
        { id: 'b', title: 'Foo', description: 'Bar' },
      ],
    };
    const result = applyTranslationsToContainer(source, {
      '/items/0/title': 'Bonjour',
      '/items/1/title': 'Eh',
    });

    expect(result).toEqual({
      items: [
        { id: 'a', title: 'Bonjour', description: 'World' },
        { id: 'b', title: 'Eh', description: 'Bar' },
      ],
    });
    // Source not mutated.
    expect(source.items[0].title).toBe('Hello');
  });

  test('best-effort tree when source missing', () => {
    const result = applyTranslationsToContainer(null, {
      '/items/0/title': 'Bonjour',
    });
    expect(result).toEqual({ items: [{ title: 'Bonjour' }] });
  });
});
