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
    expect(map['/0/message/root/children/0/children/0/text']).toBe('Your submission was received.');
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
          root: {
            type: 'root',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }],
          },
        },
      },
      {
        subject: 'Goodbye',
        message: {
          root: {
            type: 'root',
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bye' }] }],
          },
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

describe('applyTranslations — no cross-locale or source overwrite', () => {
  // We can't import applyTranslations directly (it's in resources-insert, not
  // fields). Instead we test the two building blocks that guarantee safety:
  //  1. deserializeFieldValue only touches what the translation map says
  //  2. cloneLocalizedContainersFromSource skips scalars

  test('deserializeFieldValue does not mutate the source value', () => {
    const fields: Field[] = [
      {
        name: 'chapters',
        type: 'array',
        fields: [
          { name: 'title', type: 'text', localized: true },
          { name: 'description', type: 'textarea', localized: true },
          {
            name: 'link',
            type: 'relationship',
            relationTo: 'pages',
          },
        ],
      },
    ];

    const [field] = findLocalizedFields(fields);

    const source = [
      { title: 'Chapter EN', description: 'Desc EN', link: 'page-1' },
      { title: 'Second EN', description: 'Desc2 EN', link: 'page-2' },
    ];

    const sourceCopy = JSON.parse(JSON.stringify(source));

    // Translate only ONE leaf of ONE item — everything else must come from
    // source clone, and the original source must be untouched.
    const translated: Record<string, string> = {
      '/0/title': 'Chapitre FR',
    };

    const result = deserializeFieldValue(field, source, translated) as typeof source;

    // Translated leaf applied
    expect(result[0].title).toBe('Chapitre FR');
    // Non-translated localized leaf: source value (fallback)
    expect(result[0].description).toBe('Desc EN');
    // Non-localized relationship: preserved from source
    expect(result[0].link).toBe('page-1');
    // Untranslated second item: full source clone
    expect(result[1]).toEqual({ title: 'Second EN', description: 'Desc2 EN', link: 'page-2' });
    // Original source not mutated
    expect(source).toEqual(sourceCopy);
  });

  test('updateData only contains fields Reversia sent — not all localized fields', () => {
    // Simulates the applyTranslations flow: for a collection with title (scalar),
    // slug (scalar), and chapters (container), if Reversia only sends title and
    // chapters, updateData must NOT contain slug.

    const fields: Field[] = [
      { name: 'title', type: 'text', localized: true },
      { name: 'slug', type: 'text', localized: true },
      {
        name: 'chapters',
        type: 'array',
        fields: [{ name: 'title', type: 'text', localized: true }],
      },
    ];

    const allFields = findLocalizedFields(fields);
    const fieldByName = new Map(allFields.map((f) => [f.name, f]));

    // Reversia only sent title + chapters, NOT slug
    const data: Record<string, unknown> = {
      title: 'Titre FR',
      chapters: JSON.stringify({ '/0/title': 'Chapitre FR' }),
    };

    const sourceDoc = {
      title: 'Title EN',
      slug: 'title-en',
      chapters: [{ title: 'Chapter EN', link: 'page-1' }],
    };

    // Replicate the updateData construction from applyTranslations
    const updateData: Record<string, unknown> = {};

    for (const [fieldName, translatedValue] of Object.entries(data)) {
      const field = fieldByName.get(fieldName);
      if (!field) {
        continue;
      }
      const sourceValue = sourceDoc[fieldName as keyof typeof sourceDoc];
      updateData[fieldName] = deserializeFieldValue(field, sourceValue, translatedValue);
    }

    // title: translated scalar
    expect(updateData.title).toBe('Titre FR');
    // slug: NOT in data → NOT in updateData → target locale keeps existing value
    expect(updateData.slug).toBeUndefined();
    // chapters: container, source-cloned + overlay
    const chapters = updateData.chapters as Array<{ title: string; link: string }>;
    expect(chapters[0].title).toBe('Chapitre FR');
    expect(chapters[0].link).toBe('page-1'); // non-localized sibling preserved
  });

  test('cloneLocalizedContainersFromSource never clones scalars', () => {
    const fields: Field[] = [
      { name: 'title', type: 'text', localized: true },
      { name: 'slug', type: 'text', localized: true },
      {
        name: 'seo',
        type: 'group',
        fields: [{ name: 'metaTitle', type: 'text', localized: true }],
      },
    ];

    const localized = findLocalizedFields(fields);
    const sourceDoc = { title: 'EN Title', slug: 'en-title', seo: { metaTitle: 'EN Meta' } };
    const clone = cloneLocalizedContainersFromSource(sourceDoc, localized);

    // Container cloned
    expect(clone.seo).toEqual({ metaTitle: 'EN Meta' });
    // Scalars NOT cloned — writing them would overwrite the target locale
    expect(clone.title).toBeUndefined();
    expect(clone.slug).toBeUndefined();
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

describe('required-field seeding — blocks with defaultValue and empty inner richText', () => {
  // Reproduces the pageD scenario: `content` is a localized blocks field with
  // minRows: 9 and defaultValue that auto-creates 9 block items. Each block
  // has a required `content` richText. When Reversia only sends scalar fields
  // (title, description), the plugin must seed `content` from source so
  // Payload's whole-document required validation doesn't reject the update.

  const fields: Field[] = [
    { name: 'title', type: 'text', localized: true, required: true },
    { name: 'description', type: 'textarea', localized: true },
    {
      name: 'content',
      type: 'blocks',
      localized: true,
      blocks: [
        {
          slug: 'segment',
          fields: [
            { name: 'type', type: 'select', options: ['who', 'when', 'where'] },
            { name: 'content', type: 'richText', localized: true, required: true },
          ],
        },
      ],
    },
  ];

  const allFields = findLocalizedFields(fields);

  test('containers are always marked hasRequiredLeaf', () => {
    const contentField = allFields.find((f) => f.name === 'content');
    expect(contentField?.hasRequiredLeaf).toBe(true);
  });

  test('required scalar is marked hasRequiredLeaf', () => {
    const titleField = allFields.find((f) => f.name === 'title');
    expect(titleField?.hasRequiredLeaf).toBe(true);
  });

  test('non-required scalar is NOT marked hasRequiredLeaf', () => {
    const descField = allFields.find((f) => f.name === 'description');
    expect(descField?.hasRequiredLeaf).toBeUndefined();
  });

  test('seeding fills container from source when target has empty-shell blocks', () => {
    const fieldByName = new Map(allFields.map((f) => [f.name, f]));

    // Source (sl locale): fully populated
    const sourceDoc = {
      title: 'Naslov SL',
      description: 'Opis SL',
      content: [
        {
          blockType: 'segment',
          type: 'who',
          content: { root: { type: 'root', children: [{ type: 'text', text: 'Kdo' }] } },
        },
        {
          blockType: 'segment',
          type: 'when',
          content: { root: { type: 'root', children: [{ type: 'text', text: 'Kdaj' }] } },
        },
      ],
    };

    // Target (en locale): blocks auto-created by defaultValue but richText is null
    const previousDoc = {
      title: null,
      description: null,
      content: [
        { blockType: 'segment', type: 'who', content: null },
        { blockType: 'segment', type: 'when', content: null },
      ],
    };

    // Reversia only sends scalars — NOT the blocks content
    const data: Record<string, unknown> = {
      title: 'Title EN',
    };

    const dataKeys = new Set(Object.keys(data));
    const updateData: Record<string, unknown> = {};

    // Replicate the seeding logic from applyTranslations
    for (const field of allFields) {
      if (!field.hasRequiredLeaf) {
        continue;
      }
      if (dataKeys.has(field.name)) {
        continue;
      }
      const sourceValue = sourceDoc[field.name as keyof typeof sourceDoc];
      if (sourceValue === undefined || sourceValue === null) {
        continue;
      }
      if (field.isContainer) {
        updateData[field.name] = structuredClone(sourceValue);
      } else {
        const targetValue = previousDoc[field.name as keyof typeof previousDoc];
        if (targetValue === undefined || targetValue === null || targetValue === '') {
          updateData[field.name] = sourceValue;
        }
      }
    }

    // Then apply Reversia's data
    for (const [fieldName, translatedValue] of Object.entries(data)) {
      const field = fieldByName.get(fieldName);
      if (!field) {
        continue;
      }
      updateData[fieldName] = deserializeFieldValue(field, sourceDoc[fieldName as keyof typeof sourceDoc], translatedValue);
    }

    // title: translated value from Reversia
    expect(updateData.title).toBe('Title EN');

    // description: NOT required, NOT in data → NOT seeded → not in updateData
    expect(updateData.description).toBeUndefined();

    // content: required container, NOT in data, target has empty-shell blocks
    // → seeded from source with fully populated richText
    const seededContent = updateData.content as typeof sourceDoc.content;
    expect(seededContent).toBeDefined();
    expect(seededContent.length).toBe(2);
    expect(seededContent[0].content?.root.children[0].text).toBe('Kdo');
    expect(seededContent[1].content?.root.children[0].text).toBe('Kdaj');
  });

  test('seeding does NOT overwrite existing target scalar', () => {
    // Target already has a translated title — seeding must not clobber it
    const previousDoc = { title: 'Existing EN title', content: null };
    const sourceDoc = { title: 'Naslov SL', content: null };
    const data: Record<string, unknown> = {}; // Reversia sends nothing this batch
    const dataKeys = new Set(Object.keys(data));
    const updateData: Record<string, unknown> = {};

    for (const field of allFields) {
      if (!field.hasRequiredLeaf || dataKeys.has(field.name)) {
        continue;
      }
      const sv = sourceDoc[field.name as keyof typeof sourceDoc];
      if (sv === undefined || sv === null) {
        continue;
      }
      if (field.isContainer) {
        updateData[field.name] = structuredClone(sv);
      } else {
        const tv = previousDoc[field.name as keyof typeof previousDoc];
        if (tv === undefined || tv === null || tv === '') {
          updateData[field.name] = sv;
        }
      }
    }

    // title already exists in target → NOT overwritten
    expect(updateData.title).toBeUndefined();
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

describe('deflatePopulatedRelationships', () => {
  // Import directly so we can unit-test the deflation in isolation.
  const { deflatePopulatedRelationships } = require('../../src/utils/fields.js') as {
    deflatePopulatedRelationships: (v: unknown) => unknown;
  };

  test('deflates a populated upload field nested in a document', () => {
    const doc = {
      heroImage: {
        id: '69abc',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      title: 'Hello',
    };
    const result = deflatePopulatedRelationships(doc) as Record<string, unknown>;
    expect(result.heroImage).toBe('69abc');
    expect(result.title).toBe('Hello');
  });

  test('deflates a polymorphic relationship { relationTo, value: populated }', () => {
    const doc = {
      link: {
        relationTo: 'pageC',
        value: { id: '69abc', title: 'Page', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      },
    };
    const result = deflatePopulatedRelationships(doc) as Record<string, unknown>;
    expect(result.link).toEqual({ relationTo: 'pageC', value: '69abc' });
  });

  test('leaves raw string ids untouched', () => {
    const doc = {
      media: '69abc',
      link: { relationTo: 'pageC', value: '69abc' },
    };
    const result = deflatePopulatedRelationships(doc) as Record<string, unknown>;
    expect(result.media).toBe('69abc');
    expect(result.link).toEqual({ relationTo: 'pageC', value: '69abc' });
  });

  test('recurses into array items with required relationship fields', () => {
    // Simulates the PageB `chapters` array: localized title + required polymorphic link
    const chapters = [
      {
        id: 'ch1',
        title: 'Chapter One',
        link: {
          relationTo: 'pageC',
          value: {
            id: 'pc1',
            title: 'Linked Page',
            slug: 'linked',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        },
      },
      {
        id: 'ch2',
        title: 'Chapter Two',
        link: { relationTo: 'pageD', value: 'pd1' }, // already raw
      },
    ];

    const result = deflatePopulatedRelationships(chapters) as typeof chapters;

    // Populated link deflated to raw id
    expect(result[0].link).toEqual({ relationTo: 'pageC', value: 'pc1' });
    // Already-raw link untouched
    expect(result[1].link).toEqual({ relationTo: 'pageD', value: 'pd1' });
    // Non-relationship fields preserved
    expect(result[0].title).toBe('Chapter One');
    expect(result[0].id).toBe('ch1');
  });

  test('deflates inside Lexical block nodes', () => {
    const blockNode = {
      type: 'block',
      fields: {
        id: 'b1',
        blockType: 'mediaBlock',
        media: {
          id: '69media',
          filename: 'img.png',
          mimeType: 'image/png',
          createdAt: '2026-01-01',
        },
      },
      children: [],
    };

    const result = deflatePopulatedRelationships(blockNode) as typeof blockNode;
    expect(result.fields.media).toBe('69media');
    expect(result.fields.id).toBe('b1');
    expect(result.fields.blockType).toBe('mediaBlock');
  });

  test('handles hasMany populated array inside a polymorphic relationship', () => {
    const input = {
      relationTo: 'posts',
      value: [
        { id: 'p1', title: 'Post 1', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'p2', title: 'Post 2', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
    };
    expect(deflatePopulatedRelationships(input)).toEqual({
      relationTo: 'posts',
      value: ['p1', 'p2'],
    });
  });
});
