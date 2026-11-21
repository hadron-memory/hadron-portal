import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '$env/dynamic/public';
import { parseSecretValue, secretWrite, validSecretName } from './secret-writes';

const err = (extensions: Record<string, unknown>, message = 'nope') =>
  Object.assign(new Error('x'), { response: { errors: [{ message, extensions }] }, request: { query: '', variables: {} } });
const client = (f: () => unknown) => ({ request: async () => f() }) as never;

describe('secretWrite (portal#2380)', () => {
  beforeEach(() => { env.PUBLIC_SERVER_URL = 'https://h.example'; });
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

describe('a staged link is pinned to the server public origin (portal#2417)', () => {
  const stage = (url: string) => secretWrite(client(() => { throw err({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl: url }); }), 'q', {});
  beforeEach(() => { env.PUBLIC_SERVER_URL = 'https://h.example'; });
  it('a link on another host is a plain refusal, not a staged request with a link', async () => {
    expect(await stage('https://evil.example/secret-changes/r1')).toEqual({ kind: 'plain-protected' });
  });
  it('with no configured origin no link is ever staged', async () => {
    delete env.PUBLIC_SERVER_URL;
    expect(await stage('https://h.example/secret-changes/r1')).toEqual({ kind: 'plain-protected' });
  });
});

describe('inputs', () => {
  it('names follow the server rule', () => {
    expect(validSecretName('stripe-key')).toBe(true);
    for (const n of ['', 'Stripe', 'a_b', '-foo', 'x'.repeat(65)]) expect(validSecretName(n)).toBe(false);
  });
  it('an object or array is stored as JSON; everything else is stored exactly as typed; blank is absent', () => {
    expect(parseSecretValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseSecretValue('[1, "x", true]')).toEqual([1, 'x', true]);
    expect(parseSecretValue('  ')).toBeUndefined();
    // A bare scalar is the person's text, not a different value: no true, no 1000 from 1e3, no 1.5 from 1.50, no unquoting.
    for (const typed of ['sk_live_abc', '42', 'true', 'null', '1e3', '1.50', '"quoted"', '007', '9007199254740993']) expect(parseSecretValue(typed)).toBe(typed);
    expect(parseSecretValue('{not json')).toBe('{not json');
  });
  it('a multi-line value keeps its text and its trailing newline, with the browser CRLF read as LF', () => {
    const pem = '-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----\n';
    expect(parseSecretValue(pem.replace(/\n/g, '\r\n'))).toBe(pem);
    expect(parseSecretValue(pem)).toBe(pem);
    expect(parseSecretValue('line1\r\nline2')).toBe('line1\nline2');
    expect(parseSecretValue('{not\r\njson')).toBe('{not\njson');
  });
  it('a number JSON would round, inside an object or array, stores the text typed, never a different number', () => {
    for (const lossy of ['{"id":12345678901234567890}', '[0.100000000000000005]', '{"p":1.0000000000000000001}', '[2e-400]', '{"s":1.23456789012345e-310}', '[9007199254740993]', '[1e999]']) expect(parseSecretValue(lossy)).toBe(lossy);
    expect(parseSecretValue('{"s":"12345678901234567890"}')).toEqual({ s: '12345678901234567890' });
    for (const [ok, v] of [['[1.5]', [1.5]], ['[1.50]', [1.5]], ['[0.1]', [0.1]], ['[1e3]', [1000]], ['[3.14159]', [3.14159]], ['[0.0]', [0]], ['[5e-324]', [5e-324]], ['[9007199254740991]', [9007199254740991]], ['[-0.25]', [-0.25]], ['[100]', [100]], ['[1e22]', [1e22]]] as const) expect(parseSecretValue(ok)).toEqual(v);
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
