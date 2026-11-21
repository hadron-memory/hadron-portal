import { describe, expect, it } from 'vitest';
import { parseSecretValue, secretWrite, validSecretName } from './secret-writes';

const err = (extensions: Record<string, unknown>, message = 'nope') =>
  Object.assign(new Error('x'), { response: { errors: [{ message, extensions }] }, request: { query: '', variables: {} } });
const client = (f: () => unknown) => ({ request: async () => f() }) as never;

describe('secretWrite (portal#2380)', () => {
  it('a staged edit is staged: not ok, not a generic error, with the link', async () => {
    const url = 'https://h.example/secret-changes/r1';
    const r = await secretWrite(client(() => { throw err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl: url }); }), 'q', {});
    expect(r).toEqual({ kind: 'staged', requestId: 'r1', ceremonyUrl: url });
  });
  it('a refused caller (no request staged) reads as a plain refusal', async () => {
    const r = await secretWrite(client(() => { throw err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY' }); }), 'q', {});
    expect(r).toEqual({ kind: 'plain-protected' });
  });
  it('another refusal keeps its own sentence; success passes data', async () => {
    expect(await secretWrite(client(() => { throw err({ code: 'FORBIDDEN' }, 'Not yours.'); }), 'q', {})).toEqual({ kind: 'refused', message: 'Not yours.' });
    expect(await secretWrite(client(() => ({ a: 1 })), 'q', {})).toEqual({ kind: 'ok', data: { a: 1 } });
  });
});

describe('inputs', () => {
  it('names follow the server rule', () => {
    expect(validSecretName('stripe-key')).toBe(true);
    for (const n of ['', 'Stripe', 'a_b', '-foo', 'x'.repeat(65)]) expect(validSecretName(n)).toBe(false);
  });
  it('text stays text, JSON stays JSON, blank is absent', () => {
    expect(parseSecretValue('sk_live_abc')).toBe('sk_live_abc');
    expect(parseSecretValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseSecretValue('  ')).toBeUndefined();
    expect(parseSecretValue('42')).toBe(42);
    expect(parseSecretValue('{"s":"12345678901234567890"}')).toEqual({ s: '12345678901234567890' });
  });
  it('a number JSON would round is stored as the text typed, never as a different number', () => {
    expect(parseSecretValue('9007199254740993')).toBe('9007199254740993');
    expect(parseSecretValue('{"id":12345678901234567890}')).toBe('{"id":12345678901234567890}');
    expect(parseSecretValue('1e999')).toBe('1e999');
    expect(parseSecretValue('null')).toBe('null');
    for (const lossy of ['0.100000000000000005', '1.0000000000000000001', '2e-400', '1.23456789012345e-310', '12345678901234567890', '9007199254740993', '{"p":0.100000000000000005}']) expect(parseSecretValue(lossy)).toBe(lossy);
    for (const [ok, v] of [['1.5', 1.5], ['1.50', 1.5], ['0.1', 0.1], ['1e3', 1000], ['3.14159', 3.14159], ['0.0', 0], ['5e-324', 5e-324], ['9007199254740991', 9007199254740991], ['-0.25', -0.25], ['100', 100], ['1e22', 1e22]] as const) expect(parseSecretValue(ok)).toBe(v);
  });
});

describe('a deployment without a secret key', () => {
  it('says so, in the portal\'s own words', async () => {
    const e = { response: { errors: [{ message: 'internal', extensions: { code: 'SECRET_KEY_UNAVAILABLE' } }] }, request: { query: '', variables: {} } };
    const r = await secretWrite({ request: async () => { throw e; } }, 'mutation { x }', {});
    expect(r).toMatchObject({ kind: 'refused' });
    expect((r as { message: string }).message).toContain('secret key');
    expect((r as { message: string }).message).not.toContain('internal');
  });
});
