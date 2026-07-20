import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('$lib/urn/clean-loc-input');
  vi.resetModules();
});

describe('editNodeSchema', () => {
  it('normalizes loc input before submit data reaches the action', async () => {
    const { editNodeSchema } = await import('./schema');

    const result = editNodeSchema.safeParse({
      name: 'Node',
      loc: 'parent/child',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.loc).toBe('parent:child');
    }
  });

  it('converts cleanLocInput throws into a loc field error', async () => {
    vi.doMock('$lib/urn/clean-loc-input', () => ({
      cleanLocInput: vi.fn(() => {
        throw new Error('parser failed');
      }),
    }));
    const { editNodeSchema } = await import('./schema');

    const result = editNodeSchema.safeParse({
      name: 'Node',
      loc: 'anything',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.loc?.[0]).toBe('Invalid loc.');
    }
  });

  // #588: structured storage fields.
  it('defaults objectType and propertiesJson to empty', async () => {
    const { editNodeSchema } = await import('./schema');
    const result = editNodeSchema.safeParse({ name: 'Node', loc: 'node' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectType).toBe('');
      expect(result.data.propertiesJson).toBe('');
    }
  });

  it('converts a propertiesJson parse failure into a field error', async () => {
    const { editNodeSchema } = await import('./schema');
    const result = editNodeSchema.safeParse({
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
    const { editNodeSchema } = await import('./schema');
    const result = editNodeSchema.safeParse({
      name: 'Node',
      loc: 'node',
      propertiesJson: '"scalar"',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.propertiesJson?.[0]).toMatch(/JSON object/);
    }
  });
});
