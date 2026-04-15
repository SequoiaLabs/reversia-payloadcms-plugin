import { describe, expect, test } from 'bun:test';
import type { Field } from 'payload';
import { ReversiaFieldType } from '../../src/types.js';
import {
  buildTranslatableConfiguration,
  deserializeFieldValue,
  findLocalizedFields,
  serializeField,
  serializeFieldValue,
} from '../../src/utils/fields.js';

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
    const entries = serializeField(field, {
      markdown: { raw: '# Hello', parsed: { blocks: ['anything'] } },
    });

    expect(entries).toEqual([
      { indexedPath: 'markdown', value: '# Hello', contentType: ReversiaFieldType.JSON },
    ]);
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

    expect(() => serializeFieldValue(field, { anything: true })).toThrow(
      /requires a matching reversia.apply/,
    );
  });
});

describe('JSON field with translatableKeys', () => {
  const fields: Field[] = [
    {
      name: 'spec',
      type: 'json',
      localized: true,
      custom: {
        reversia: {
          translatableKeys: ['label', 'description'],
        },
      },
    },
  ];

  test('ships only leaf strings matching translatableKeys and round-trips', () => {
    const [field] = findLocalizedFields(fields);
    const doc = {
      spec: {
        label: 'Pricing',
        description: 'Monthly plan',
        sku: 'PLAN-001',
        tags: ['a', 'b'],
        nested: { label: 'Extra', note: 'ignore me' },
      },
    };

    const [entry] = serializeField(field, doc);
    expect(entry.contentType).toBe(ReversiaFieldType.JSON);

    const parsed = JSON.parse(entry.value as string) as Record<string, string>;
    const values = Object.values(parsed).sort();
    expect(values).toEqual(['Extra', 'Monthly plan', 'Pricing']);
    // sku / tags / nested.note stay local
    expect(Object.values(parsed)).not.toContain('PLAN-001');
    expect(Object.values(parsed)).not.toContain('ignore me');

    // Simulate Reversia sending back the same shape with translated strings.
    const translatedMap: Record<string, string> = {};
    for (const [pointer] of Object.entries(parsed)) {
      translatedMap[pointer] = `fr:${parsed[pointer]}`;
    }

    const result = deserializeFieldValue(field, doc.spec, translatedMap);
    expect(result).toEqual({
      label: 'fr:Pricing',
      description: 'fr:Monthly plan',
      sku: 'PLAN-001',
      tags: ['a', 'b'],
      nested: { label: 'fr:Extra', note: 'ignore me' },
    });
  });
});

describe('buildNestedLabel', () => {
  test('humanises camelCase segments and joins with >', () => {
    const fields: Field[] = [
      {
        name: 'seo_meta',
        type: 'group',
        fields: [
          {
            name: 'pageTitle',
            type: 'text',
            localized: true,
          },
        ],
      },
    ];

    const config = buildTranslatableConfiguration(findLocalizedFields(fields));

    expect(config['seo_meta.pageTitle']).toBeDefined();
    expect(config['seo_meta.pageTitle'].label).toBe('Seo Meta > Page Title');
  });

  test('falls back to humanised field name when no label is set', () => {
    const fields: Field[] = [
      {
        name: 'outerGroup',
        type: 'group',
        fields: [
          {
            name: 'inner_field',
            type: 'text',
            localized: true,
          },
        ],
      },
    ];

    const config = buildTranslatableConfiguration(findLocalizedFields(fields));
    expect(config['outerGroup.inner_field'].label).toBe('Outer Group > Inner Field');
  });

  test('top-level fields without a label use humanised name', () => {
    const fields: Field[] = [
      {
        name: 'meta_description',
        type: 'text',
        localized: true,
      },
    ];

    const config = buildTranslatableConfiguration(findLocalizedFields(fields));
    expect(config.meta_description.label).toBe('Meta Description');
  });
});
