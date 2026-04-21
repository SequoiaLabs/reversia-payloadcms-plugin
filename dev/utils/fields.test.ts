import { describe, expect, test } from 'bun:test';
import type { Field } from 'payload';
import { ReversiaFieldType } from '../../src/types.js';
import {
  buildTranslatableConfiguration,
  cloneLocalizedContainersFromSource,
  deserializeFieldValue,
  findLocalizedFields,
  serializeField,
} from '../../src/utils/fields.js';

describe('findLocalizedFields — top-level container model', () => {
  test('top-level localized scalar is non-container', () => {
    const fields: Field[] = [{ name: 'title', type: 'text', localized: true }];
    const [field] = findLocalizedFields(fields);
    expect(field.name).toBe('title');
    expect(field.isContainer).toBe(false);
    expect(field.leaves).toEqual([
      { segments: [], kind: 'scalar', payloadFieldType: 'text', reversia: undefined },
    ]);
  });

  test('top-level richText is a container with one json leaf', () => {
    const fields: Field[] = [{ name: 'content', type: 'richText', localized: true }];
    const [field] = findLocalizedFields(fields);
    expect(field.isContainer).toBe(true);
    expect(field.leaves[0].kind).toBe('json');
  });

  test('group with a localized subfield becomes a container', () => {
    const fields: Field[] = [
      {
        name: 'seo',
        type: 'group',
        fields: [{ name: 'metaTitle', type: 'text', localized: true }],
      },
    ];
    const [field] = findLocalizedFields(fields);
    expect(field.name).toBe('seo');
    expect(field.isContainer).toBe(true);
    expect(field.leaves).toEqual([
      {
        segments: [{ kind: 'key', name: 'metaTitle' }],
        kind: 'scalar',
        payloadFieldType: 'text',
        reversia: undefined,
      },
    ]);
  });

  test('array with localized subfield becomes a container with iterate segment', () => {
    const fields: Field[] = [
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'title', type: 'text', localized: true }],
      },
    ];
    const [field] = findLocalizedFields(fields);
    expect(field.isContainer).toBe(true);
    expect(field.leaves[0].segments).toEqual([{ kind: 'iterate' }, { kind: 'key', name: 'title' }]);
  });

  test('blocks contribute one leaf set per block slug, filtered by blockType', () => {
    const fields: Field[] = [
      {
        name: 'body',
        type: 'blocks',
        blocks: [
          {
            slug: 'hero',
            fields: [{ name: 'heading', type: 'text', localized: true }],
          },
          {
            slug: 'callout',
            fields: [
              { name: 'message', type: 'text', localized: true },
              { name: 'url', type: 'text' /* not localized */ },
            ],
          },
        ],
      },
    ];

    const [field] = findLocalizedFields(fields);
    expect(field.isContainer).toBe(true);
    expect(field.leaves.map((l) => l.segments)).toEqual([
      [
        { kind: 'iterateBlock', blockSlug: 'hero' },
        { kind: 'key', name: 'heading' },
      ],
      [
        { kind: 'iterateBlock', blockSlug: 'callout' },
        { kind: 'key', name: 'message' },
      ],
    ]);
  });

  test('non-localized field with no localized descendants is skipped', () => {
    const fields: Field[] = [
      { name: 'internalNotes', type: 'text' },
      { name: 'tags', type: 'array', fields: [{ name: 'name', type: 'text' }] },
    ];
    expect(findLocalizedFields(fields)).toEqual([]);
  });
});

describe('serializeField — single entry per top-level field', () => {
  test('scalar passes through verbatim', () => {
    const fields: Field[] = [{ name: 'title', type: 'text', localized: true }];
    const [field] = findLocalizedFields(fields);
    const entry = serializeField(field, { title: 'Hello' });
    expect(entry).toEqual({ name: 'title', value: 'Hello', contentType: undefined });
  });

  test('group with localized subfield produces one JSON entry', () => {
    const fields: Field[] = [
      {
        name: 'seo',
        type: 'group',
        fields: [
          { name: 'metaTitle', type: 'text', localized: true },
          { name: 'analyticsId', type: 'text' /* not localized → not in map */ },
        ],
      },
    ];
    const [field] = findLocalizedFields(fields);
    const entry = serializeField(field, {
      seo: { metaTitle: 'Hello', analyticsId: 'ABC' },
    });

    expect(entry?.contentType).toBe(ReversiaFieldType.JSON);
    expect(JSON.parse(entry?.value as string)).toEqual({ '/metaTitle': 'Hello' });
  });

  test('array with localized subfield emits one entry per array item under the same JSON', () => {
    const fields: Field[] = [
      {
        name: 'items',
        type: 'array',
        fields: [
          { name: 'title', type: 'text', localized: true },
          { name: 'sku', type: 'text' /* non-localized → filtered */ },
        ],
      },
    ];
    const [field] = findLocalizedFields(fields);
    const entry = serializeField(field, {
      items: [
        { title: 'A', sku: 'P-1' },
        { title: 'B', sku: 'P-2' },
      ],
    });

    expect(entry?.contentType).toBe(ReversiaFieldType.JSON);
    expect(JSON.parse(entry?.value as string)).toEqual({
      '/0/title': 'A',
      '/1/title': 'B',
    });
  });

  test('blocks: only the matching blockType contributes leaves', () => {
    const fields: Field[] = [
      {
        name: 'body',
        type: 'blocks',
        blocks: [
          {
            slug: 'hero',
            fields: [{ name: 'heading', type: 'text', localized: true }],
          },
          {
            slug: 'callout',
            fields: [{ name: 'message', type: 'text', localized: true }],
          },
        ],
      },
    ];
    const [field] = findLocalizedFields(fields);
    const entry = serializeField(field, {
      body: [
        { blockType: 'hero', heading: 'Welcome' },
        { blockType: 'callout', message: 'Buy now' },
        { blockType: 'hero', heading: 'Subscribe' },
      ],
    });

    expect(JSON.parse(entry?.value as string)).toEqual({
      '/0/heading': 'Welcome',
      '/2/heading': 'Subscribe',
      '/1/message': 'Buy now',
    });
  });

  test('returns undefined when nothing is translatable (empty container)', () => {
    const fields: Field[] = [
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'title', type: 'text', localized: true }],
      },
    ];
    const [field] = findLocalizedFields(fields);
    expect(serializeField(field, { items: [] })).toBeUndefined();
  });
});

describe('extract / apply escape hatch', () => {
  const fields: Field[] = [
    {
      name: 'markdown',
      type: 'json',
      localized: true,
      custom: {
        reversia: {
          extract: (value: unknown) => (value as { raw: string }).raw,
          apply: (sourceValue: unknown, translated: string) => ({
            ...(sourceValue as object),
            raw: translated,
          }),
        },
      },
    },
  ];

  test('serializeField pipes the value through extract', () => {
    const [field] = findLocalizedFields(fields);
    const entry = serializeField(field, {
      markdown: { raw: '# Hello', parsed: { blocks: ['anything'] } },
    });

    expect(entry).toEqual({
      name: 'markdown',
      value: '# Hello',
      contentType: ReversiaFieldType.JSON,
    });
  });

  test('deserializeFieldValue passes source + translated through apply', () => {
    const [field] = findLocalizedFields(fields);
    const source = { raw: '# Hello', parsed: { blocks: ['original'] } };
    const result = deserializeFieldValue(field, source, '# Bonjour');

    expect(result).toEqual({
      raw: '# Bonjour',
      parsed: { blocks: ['original'] },
    });
  });

  test('extract without apply throws', () => {
    const [field] = findLocalizedFields([
      {
        name: 'markdown',
        type: 'json',
        localized: true,
        custom: {
          reversia: { extract: (value: unknown) => String(value) },
        },
      },
    ]);

    expect(() => serializeField(field, { markdown: { anything: true } })).toThrow(
      /requires a matching reversia.apply/,
    );
  });
});

describe('richText container with translatableKeys', () => {
  test('extracts text/url/alt by default; round-trips through deserialize', () => {
    const fields: Field[] = [{ name: 'content', type: 'richText', localized: true }];
    const [field] = findLocalizedFields(fields);

    const sourceTree = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      },
    };

    const entry = serializeField(field, { content: sourceTree });
    expect(entry?.contentType).toBe(ReversiaFieldType.JSON);

    const parsed = JSON.parse(entry?.value as string) as Record<string, string>;
    expect(parsed).toEqual({ '/root/children/0/children/0/text': 'Hello world' });

    const translated: Record<string, string> = {
      '/root/children/0/children/0/text': 'Bonjour le monde',
    };
    const result = deserializeFieldValue(field, sourceTree, translated);

    expect(result).toEqual({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Bonjour le monde' }],
          },
        ],
      },
    });
  });
});

describe('deserializeFieldValue — source-clone overlay', () => {
  test('clones source array structure and overlays translated leaves only', () => {
    const fields: Field[] = [
      {
        name: 'items',
        type: 'array',
        fields: [
          { name: 'id', type: 'text' },
          { name: 'title', type: 'text', localized: true },
          { name: 'sku', type: 'text' },
        ],
      },
    ];

    const [field] = findLocalizedFields(fields);
    const source = [
      { id: 'a', title: 'Hello', sku: 'P-1' },
      { id: 'b', title: 'World', sku: 'P-2' },
    ];

    const translated = { '/0/title': 'Bonjour', '/1/title': 'Monde' };

    expect(deserializeFieldValue(field, source, translated)).toEqual([
      { id: 'a', title: 'Bonjour', sku: 'P-1' },
      { id: 'b', title: 'Monde', sku: 'P-2' },
    ]);
  });

  test('falls back to source clone when translation map is empty / unparseable', () => {
    const fields: Field[] = [{ name: 'content', type: 'richText', localized: true }];
    const [field] = findLocalizedFields(fields);
    const source = { root: { type: 'root', children: [] } };
    expect(deserializeFieldValue(field, source, 'not json')).toEqual(source);
  });
});

describe('richText inside array — extract + deserialize round-trip', () => {
  const fields: Field[] = [
    {
      name: 'emails',
      type: 'array',
      fields: [
        { name: 'emailTo', type: 'text' },
        { name: 'subject', type: 'text', localized: true },
        {
          name: 'message',
          type: 'richText',
          localized: true,
        },
      ],
    },
  ];

  const sourceEmails = [
    {
      emailTo: 'user@example.com',
      subject: 'You received a message.',
      message: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'Your submission was received.' }],
            },
          ],
        },
      },
    },
  ];

  test('extraction emits scalar + richText leaves under the same array container', () => {
    const [field] = findLocalizedFields(fields);
    const entry = serializeField(field, { emails: sourceEmails });

    expect(entry).toBeDefined();
    expect(entry?.contentType).toBe(ReversiaFieldType.JSON);

    const map = JSON.parse(entry?.value as string) as Record<string, string>;

    // Scalar leaf: subject
    expect(map['/0/subject']).toBe('You received a message.');
    // RichText leaf: text inside message tree
    expect(map['/0/message/root/children/0/children/0/text']).toBe(
      'Your submission was received.',
    );
    // Non-localized fields stay out of the map
    expect(Object.values(map)).not.toContain('user@example.com');
  });

  test('deserialization applies both scalar and richText translations under iterate', () => {
    const [field] = findLocalizedFields(fields);

    const translated: Record<string, string> = {
      '/0/subject': 'Vous avez reçu un message.',
      '/0/message/root/children/0/children/0/text': 'Votre soumission a été reçue.',
    };

    const result = deserializeFieldValue(field, sourceEmails, translated) as typeof sourceEmails;

    // Non-localized field preserved from source
    expect(result[0].emailTo).toBe('user@example.com');
    // Scalar leaf translated
    expect(result[0].subject).toBe('Vous avez reçu un message.');
    // RichText leaf translated within preserved tree structure
    expect(result[0].message.root.children[0].children[0].text).toBe(
      'Votre soumission a été reçue.',
    );
    // Tree structure metadata preserved
    expect(result[0].message.root.type).toBe('root');
    expect(result[0].message.root.children[0].type).toBe('paragraph');
  });

  test('handles multiple array items with mixed block types', () => {
    const multiFields: Field[] = [
      {
        name: 'emails',
        type: 'array',
        fields: [
          { name: 'subject', type: 'text', localized: true },
          { name: 'message', type: 'richText', localized: true },
        ],
      },
    ];

    const [field] = findLocalizedFields(multiFields);

    const source = [
      {
        subject: 'Welcome',
        message: {
          root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }] },
        },
      },
      {
        subject: 'Goodbye',
        message: {
          root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bye' }] }] },
        },
      },
    ];

    // Extract
    const entry = serializeField(field, { emails: source });
    const map = JSON.parse(entry?.value as string) as Record<string, string>;

    expect(map['/0/subject']).toBe('Welcome');
    expect(map['/1/subject']).toBe('Goodbye');
    expect(map['/0/message/root/children/0/children/0/text']).toBe('Hello');
    expect(map['/1/message/root/children/0/children/0/text']).toBe('Bye');

    // Translate only item 1
    const translated: Record<string, string> = {
      '/0/subject': 'Bienvenue',
      '/1/subject': 'Au revoir',
      '/0/message/root/children/0/children/0/text': 'Bonjour',
      '/1/message/root/children/0/children/0/text': 'Salut',
    };

    const result = deserializeFieldValue(field, source, translated) as typeof source;

    expect(result[0].subject).toBe('Bienvenue');
    expect(result[1].subject).toBe('Au revoir');
    expect(result[0].message.root.children[0].children[0].text).toBe('Bonjour');
    expect(result[1].message.root.children[0].children[0].text).toBe('Salut');
  });
});

describe('cloneLocalizedContainersFromSource', () => {
  test('only clones the top-level fields that contain localized leaves', () => {
    const fields: Field[] = [
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'title', type: 'text', localized: true }],
      },
      { name: 'tags', type: 'array', fields: [{ name: 'name', type: 'text' }] },
    ];

    const localized = findLocalizedFields(fields);
    const sourceDoc = {
      items: [{ id: 'a', title: 'Hello' }],
      tags: ['internal', 'private'],
    };

    const clone = cloneLocalizedContainersFromSource(sourceDoc, localized);

    expect(clone).toEqual({ items: [{ id: 'a', title: 'Hello' }] });
    // structuredClone — mutating the clone should not affect source.
    (clone.items as Array<{ title: string }>)[0].title = 'Mutated';
    expect((sourceDoc.items[0] as { title: string }).title).toBe('Hello');
  });
});

describe('buildTranslatableConfiguration', () => {
  test('keys configuration by top-level field name', () => {
    const fields: Field[] = [
      { name: 'title', type: 'text', localized: true },
      {
        name: 'seo',
        type: 'group',
        fields: [{ name: 'metaTitle', type: 'text', localized: true }],
      },
    ];

    const config = buildTranslatableConfiguration(findLocalizedFields(fields));
    expect(Object.keys(config).sort()).toEqual(['seo', 'title']);
    expect(config.title).toEqual({ label: 'Title', asLabel: true });
    expect(config.seo).toEqual({ label: 'Seo', type: ReversiaFieldType.JSON });
  });

  test('humanises field names when no explicit label is set', () => {
    const fields: Field[] = [{ name: 'meta_description', type: 'text', localized: true }];
    const config = buildTranslatableConfiguration(findLocalizedFields(fields));
    expect(config.meta_description.label).toBe('Meta Description');
  });
});
