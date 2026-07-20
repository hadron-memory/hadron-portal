import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('$lib/urn/clean-loc-input');
  vi.resetModules();
});

describe('createNodeSchema', () => {
  it('converts cleanLocInput throws into a loc field error', async () => {
    vi.doMock('$lib/urn/clean-loc-input', () => ({
      cleanLocInput: vi.fn(() => {
        throw new Error('parser failed');
      }),
    }));
    const { createNodeSchema } = await import('./schema');

    const result = createNodeSchema.safeParse({
      name: 'Node',
      loc: 'anything',
      nodeType: 'info',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.loc?.[0]).toBe('Loc is required.');
    }
  });

  // #588: structured storage fields.
  it('defaults objectType and propertiesJson to empty', async () => {
    const { createNodeSchema } = await import('./schema');
    const result = createNodeSchema.safeParse({ name: 'Node', loc: 'node' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectType).toBe('');
      expect(result.data.propertiesJson).toBe('');
    }
  });

  it('converts a propertiesJson parse failure into a field error', async () => {
    const { createNodeSchema } = await import('./schema');
    const result = createNodeSchema.safeParse({
      name: 'Node',
      loc: 'node',
      propertiesJson: '{ not json',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.propertiesJson?.[0]).toBe('Not valid JSON.');
    }
  });

  it('rejects a non-object propertiesJson payload', async () => {
    const { createNodeSchema } = await import('./schema');
    const result = createNodeSchema.safeParse({
      name: 'Node',
      loc: 'node',
      propertiesJson: '[1, 2]',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.propertiesJson?.[0]).toMatch(/JSON object/);
    }
  });

  it('accepts a valid propertiesJson object', async () => {
    const { createNodeSchema } = await import('./schema');
    const result = createNodeSchema.safeParse({
      name: 'Node',
      loc: 'node',
      objectType: 'competitor',
      propertiesJson: '{"name": "Acme", "fundingUsd": 5}',
    });
    expect(result.success).toBe(true);
  });
});
