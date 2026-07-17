import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('$lib/urn/parse-urn');
  vi.resetModules();
});

describe('orgProfileSchema', () => {
  it('turns parseDisplayUrn failures into a field error', async () => {
    vi.doMock('$lib/urn/parse-urn', async () => {
      const actual = await vi.importActual<typeof import('$lib/urn/parse-urn')>('$lib/urn/parse-urn');
      return {
        ...actual,
        parseDisplayUrn: () => {
          throw new Error('bad urn');
        },
      };
    });

    const { orgProfileSchema } = await import('./schema');
    const result = orgProfileSchema.safeParse({ name: 'Acme', urn: 'bad' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.urn?.[0]).toBe('Invalid organization URN.');
    }
  });
});
