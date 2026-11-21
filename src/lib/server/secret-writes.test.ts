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
    for (const n of ['', 'Stripe', 'a_b', 'x'.repeat(65)]) expect(validSecretName(n)).toBe(false);
  });
  it('text stays text, JSON stays JSON, blank is absent', () => {
    expect(parseSecretValue('sk_live_abc')).toBe('sk_live_abc');
    expect(parseSecretValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseSecretValue('  ')).toBeUndefined();
  });
});
