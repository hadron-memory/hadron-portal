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
});
