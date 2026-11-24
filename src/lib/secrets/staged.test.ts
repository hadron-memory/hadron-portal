import { describe, expect, it } from 'vitest';
import { readStagedChange, rebuildCeremonyUrl, safeCeremonyUrl, requestStateText, isOpenState } from './staged';

const ORIGIN = 'https://hadron.example';
const wire = (extensions: Record<string, unknown>, message = 'x') => ({
  response: { errors: [{ message, extensions }] },
  request: { query: '', variables: {} },
});

describe('readStagedChange (portal#2380)', () => {
  it('reads a staged refusal: request id and the server ceremony link, verbatim', () => {
    const url = 'https://hadron.example/secret-changes/abc123';
    expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl: url }), ORIGIN)).toEqual({
      kind: 'staged',
      requestId: 'r1',
      ceremonyUrl: url,
    });
  });

  it('a refusal with neither id nor link is a plain refusal, never an open request (hrn:node:hadronmemory.com:specs:cor:sec:070)', () => {
    expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY' }), ORIGIN)).toEqual({ kind: 'plain-protected' });
  });

  it('a link that is not an http(s) URL under /secret-changes/ is never rendered as a link, and the request is still open (portal#2470)', () => {
    for (const ceremonyUrl of ['javascript:alert(1)', 'javascript:/secret-changes/x', 'https://h.example/elsewhere/x', '/secret-changes/x', 'not a url']) {
      const r = readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl }), ORIGIN);
      expect(r).toEqual({ kind: 'staged-unlinked' });
      expect(JSON.stringify(r)).not.toContain(ceremonyUrl);
    }
  });

  it('a request id with no link at all is still an open request the portal cannot link (portal#2470)', () => {
    expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1' }), ORIGIN)).toEqual({ kind: 'staged-unlinked' });
  });

  it('a link without a usable request id is a plain refusal: the id, not the code or the link, says a request is open (portal#2470)', () => {
    const ceremonyUrl = 'https://hadron.example/secret-changes/r1';
    for (const requestId of [undefined, '', 'x'.repeat(129), 7]) {
      expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId, ceremonyUrl }), ORIGIN)).toEqual({ kind: 'plain-protected' });
    }
  });

  it('any other error is not a staged change', () => {
    expect(readStagedChange(wire({ code: 'FORBIDDEN' }), ORIGIN)).toBeNull();
    expect(readStagedChange(new Error('boom'), ORIGIN)).toBeNull();
  });
});

describe('the link is pinned to the server public origin (portal#2417)', () => {
  const staged = (ceremonyUrl: string, origin: string | null) =>
    readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl }), origin);
  it('a link on another host is never a link, whatever its path', () => {
    for (const u of [
      'https://evil.example/secret-changes/r1',
      'https://hadron.example.evil.example/secret-changes/r1',
      'https://evil.example\\@hadron.example/secret-changes/r1',
      'https://hadron.example@evil.example/secret-changes/r1',
      'https://user:pw@hadron.example/secret-changes/r1',
      'http://hadron.example/secret-changes/r1',
      'https://hadron.example:8443/secret-changes/r1',
    ]) expect(staged(u, ORIGIN)).toEqual({ kind: 'staged-unlinked' });
  });
  it('an unset or unusable origin means no link at all, never a guess', () => {
    expect(staged('https://hadron.example/secret-changes/r1', null)).toEqual({ kind: 'staged-unlinked' });
    expect(safeCeremonyUrl('http://localhost:4000/secret-changes/r1', null)).toBeNull();
  });
  it('the exact origin still passes, and a port is part of the origin', () => {
    expect(safeCeremonyUrl('https://hadron.example:8443/secret-changes/r1', 'https://hadron.example:8443')).not.toBeNull();
  });
});

describe('the tracked link is rebuilt from the pinned origin (portal#2417)', () => {
  it("is the server's own shape: origin + /secret-changes/ + id, no query or fragment", () => {
    expect(rebuildCeremonyUrl('r1', 'https://hadron.example')).toBe('https://hadron.example/secret-changes/r1');
  });
  it('an unconfigured origin is no link, never a guess', () => {
    expect(rebuildCeremonyUrl('r1', null)).toBe(null);
  });
  it('a hostile id stays one segment inside /secret-changes/: no query, no fragment, no traversal', () => {
    for (const id of ['a?b', 'a#f', 'a/b', 'a%2fb', 'a b', 'ç', '.']) {
      const out = rebuildCeremonyUrl(id, 'https://hadron.example') as string | null;
      if (out === null) continue;
      const u = new URL(out);
      expect(u.origin).toBe('https://hadron.example');
      expect(u.pathname.startsWith('/secret-changes/')).toBe(true);
      expect(u.search).toBe('');
      expect(u.hash).toBe('');
    }
    expect(rebuildCeremonyUrl('..', 'https://hadron.example')).toBe(null);
    expect(rebuildCeremonyUrl('../x', 'https://hadron.example')).toBe(null);
  });
});

describe('request state', () => {
  it('only open is actionable; every state has plain copy', () => {
    expect(isOpenState('open')).toBe(true);
    for (const s of ['completed', 'expired', 'withdrawn', 'stale']) expect(isOpenState(s)).toBe(false);
    for (const s of ['open', 'completed', 'expired', 'withdrawn', 'stale']) expect(requestStateText(s)).not.toBe('');
    expect(requestStateText('weird')).toBe('weird');
  });
});
