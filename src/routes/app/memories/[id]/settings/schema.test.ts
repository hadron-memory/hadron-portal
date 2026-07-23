import { describe, expect, it } from 'vitest';
import { SCHEMA_JSON_MAX, memorySchemaSettingsSchema } from './schema';

function schemaJsonError(input: { schemaJson: string }): string | undefined {
  const result = memorySchemaSettingsSchema.safeParse(input);
  if (result.success) return undefined;
  return result.error.flatten().fieldErrors.schemaJson?.[0];
}

describe('memorySchemaSettingsSchema (#588)', () => {
  it('accepts an empty editor (clears the schema)', () => {
    const result = memorySchemaSettingsSchema.safeParse({ schemaJson: '   ' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid schema document', () => {
    const result = memorySchemaSettingsSchema.safeParse({
      schemaJson: JSON.stringify({
        objectTypes: { competitor: { fields: { name: { type: 'text', required: true } } } },
      }),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data._kind).toBe('updateSchema');
  });

  it('converts a JSON parse failure into a field error', () => {
    expect(schemaJsonError({ schemaJson: '{ not json' })).toBe('Not valid JSON.');
  });

  it('converts a malformed schema into a field error with the validator detail', () => {
    expect(
      schemaJsonError({ schemaJson: JSON.stringify({ objectTypes: {} }) }),
    ).toMatch(/non-empty "objectTypes"/);
  });

  it('rejects an oversized document before parsing it', () => {
    const big = `"${'x'.repeat(SCHEMA_JSON_MAX + 1)}"`;
    expect(schemaJsonError({ schemaJson: big })).toMatch(/too large/);
  });

  it('rejects a wrong _kind discriminator', () => {
    const result = memorySchemaSettingsSchema.safeParse({
      _kind: 'updateVectorIndex',
      schemaJson: '',
    });
    expect(result.success).toBe(false);
  });
});
