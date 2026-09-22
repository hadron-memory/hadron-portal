import { describe, expect, it } from 'vitest';
import { DATA_KEY_MAX, PASSPHRASE_MAX, PASSPHRASE_MIN, SCHEMA_JSON_MAX, dataKeyProblem, encryptMemorySchema, memorySchemaSettingsSchema } from './schema';

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

/**
 * #873 — the encrypt form's validation.
 *
 * These rules exist because the failure they prevent is unrecoverable. The
 * server validates the key too and its verdict is authoritative, but it cannot
 * catch a MISTYPED passphrase: both halves look like a valid passphrase to it,
 * and by the time anyone notices, the content is ciphertext under a key nobody
 * knows.
 */
describe('dataKeyProblem (#873)', () => {
  // 32 bytes → base64. The only length the server accepts.
  const valid = btoa('A'.repeat(32));

  it('accepts a base64 key that decodes to exactly 32 bytes', () => {
    expect(dataKeyProblem(valid)).toBeNull();
    expect(dataKeyProblem(`  ${valid}  `)).toBeNull();
  });

  it('rejects an empty key with a message that names the alternative', () => {
    expect(dataKeyProblem('')).toContain('passphrase');
  });

  it.each([
    ['not base64 at all', 'not-a-key!!'],
    ['base64 with an illegal character', `${btoa('A'.repeat(32)).slice(0, -2)}$=`],
  ])('rejects %s', (_what, input) => {
    expect(dataKeyProblem(input)).toBe('Not valid base64.');
  });

  /**
   * The case a length rule would wave through, and the reason this decodes
   * rather than counting characters: 44 base64 characters can carry 33 bytes,
   * so `'a'.repeat(44)` is the right LENGTH and the wrong KEY. The server would
   * reject it; a character-count check here would not.
   */
  it('rejects a key of the right length that decodes to the wrong size', () => {
    const wrongSize = 'a'.repeat(44);
    expect(wrongSize).toHaveLength(valid.length);
    expect(dataKeyProblem(wrongSize)).toMatch(/32 bytes/);
  });

  it.each([
    ['31 bytes', btoa('A'.repeat(31))],
    ['33 bytes', btoa('A'.repeat(33))],
  ])('rejects %s and says what it measured', (_what, input) => {
    expect(dataKeyProblem(input)).toMatch(/32 bytes/);
  });
});

describe('encryptMemorySchema (#873)', () => {
  const ok = {
    mode: 'passphrase' as const,
    passphrase: 'correct horse battery staple',
    passphraseConfirm: 'correct horse battery staple',
    confirmIrreversible: 'true',
  };
  const errorsFor = (input: Record<string, unknown>) => {
    const result = encryptMemorySchema.safeParse(input);
    return result.success ? {} : result.error.flatten().fieldErrors;
  };

  it('accepts a confirmed matching passphrase', () => {
    expect(encryptMemorySchema.safeParse(ok).success).toBe(true);
  });

  // The unrecoverable one. Nothing downstream can detect it.
  it('rejects a passphrase that does not match its confirmation', () => {
    expect(errorsFor({ ...ok, passphraseConfirm: 'correct horse battery stapel' }).passphraseConfirm?.[0])
      .toContain('do not match');
  });

  it('rejects a passphrase below the floor, and does not also complain about the mismatch', () => {
    const short = 'a'.repeat(PASSPHRASE_MIN - 1);
    const errors = errorsFor({ ...ok, passphrase: short, passphraseConfirm: short });
    expect(errors.passphrase?.[0]).toContain(String(PASSPHRASE_MIN));
    // One error, not two: the length check returns early so the user is told
    // the one thing to fix rather than a mismatch they did not cause.
    expect(errors.passphraseConfirm).toBeUndefined();
  });

  it('accepts a passphrase exactly at the floor', () => {
    const atFloor = 'a'.repeat(PASSPHRASE_MIN);
    expect(encryptMemorySchema.safeParse({ ...ok, passphrase: atFloor, passphraseConfirm: atFloor }).success)
      .toBe(true);
  });

  it('requires the irreversibility confirmation', () => {
    expect(errorsFor({ ...ok, confirmIrreversible: 'false' }).confirmIrreversible?.[0])
      .toContain('cannot be undone');
    // Omitted entirely is the same refusal — the default is false, not true.
    const { confirmIrreversible: _omitted, ...withoutAck } = ok;
    expect(errorsFor(withoutAck).confirmIrreversible).toBeDefined();
  });

  // `mode` decides which field is validated, so a value left in the other one
  // by a user switching modes cannot fail the submit it is not part of.
  it('validates only the field its mode names', () => {
    expect(encryptMemorySchema.safeParse({ ...ok, dataKey: 'garbage!!' }).success).toBe(true);
    expect(
      encryptMemorySchema.safeParse({
        mode: 'dataKey',
        dataKey: btoa('A'.repeat(32)),
        passphrase: 'too short',
        passphraseConfirm: 'mismatched',
        confirmIrreversible: 'true',
      }).success,
    ).toBe(true);
  });

  it('rejects a bad data key in dataKey mode', () => {
    expect(errorsFor({ mode: 'dataKey', dataKey: 'nope', confirmIrreversible: 'true' }).dataKey)
      .toBeDefined();
  });
});

// @copilot on #884 — `dataKeyProblem` called `atob` before any size check, so
// an authenticated POST could hand the portal arbitrary input to allocate and
// decode. A valid key is 44 characters, so the cap costs nothing real.
describe('dataKeyProblem — size before decode (#884)', () => {
  it('rejects an oversized value without attempting to decode it', () => {
    expect(dataKeyProblem('A'.repeat(DATA_KEY_MAX + 1))).toBe('Too long to be a 32-byte key.');
  });

  it('still reaches the 32-byte message for a value inside the cap', () => {
    // The control that keeps the cap from swallowing the useful error: a
    // near-miss must still be told what it actually is.
    const inside = 'A'.repeat(48);
    expect(inside.length).toBeLessThan(DATA_KEY_MAX);
    expect(dataKeyProblem(inside)).toMatch(/32 bytes|base64/);
  });

  it('caps the raw fields in the schema too, so the action never sees a huge body', () => {
    const tooLong = { mode: 'dataKey' as const, dataKey: 'A'.repeat(DATA_KEY_MAX + 10), confirmIrreversible: 'true' };
    expect(encryptMemorySchema.safeParse(tooLong).success).toBe(false);
    const hugePassphrase = {
      mode: 'passphrase' as const,
      passphrase: 'x'.repeat(PASSPHRASE_MAX + 1),
      passphraseConfirm: 'x'.repeat(PASSPHRASE_MAX + 1),
      confirmIrreversible: 'true',
    };
    expect(encryptMemorySchema.safeParse(hugePassphrase).success).toBe(false);
  });
});
