import { describe, expect, it } from 'vitest';
import { readStagedChange, requestStateText, isOpenState } from './staged';

const wire = (extensions: Record<string, unknown>, message = 'x') => ({
  response: { errors: [{ message, extensions }] },
  request: { query: '', variables: {} },
});

describe('readStagedChange (portal#2380)', () => {
  it('reads a staged refusal: request id and the server ceremony link, verbatim', () => {
    const url = 'https://hadron.example/secret-changes/abc123';
    expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl: url }))).toEqual({
      kind: 'staged',
      requestId: 'r1',
      ceremonyUrl: url,
    });
  });

  it('a refusal with neither id nor link is a plain refusal, never an open request (hrn:node:hadronmemory.com:specs:cor:sec:070)', () => {
    expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY' }))).toEqual({ kind: 'plain-protected' });
  });

  it('a link that is not an http(s) URL under /secret-changes/ is never rendered as a link', () => {
    for (const ceremonyUrl of ['javascript:alert(1)', 'https://h.example/elsewhere/x', '/secret-changes/x', 'not a url']) {
      expect(readStagedChange(wire({ code: 'SECRET_PROTECTED_NEEDS_PASSKEY', requestId: 'r1', ceremonyUrl }))).toEqual({ kind: 'plain-protected' });
    }
  });

  it('any other error is not a staged change', () => {
    expect(readStagedChange(wire({ code: 'FORBIDDEN' }))).toBeNull();
    expect(readStagedChange(new Error('boom'))).toBeNull();
  });
});

describe('request state', () => {
  it('only open is actionable; every state has plain copy', () => {
    expect(isOpenState('open')).toBe(true);
    for (const s of ['completed', 'declined', 'expired', 'withdrawn', 'stale']) expect(isOpenState(s)).toBe(false);
    for (const s of ['open', 'completed', 'declined', 'expired', 'withdrawn', 'stale']) expect(requestStateText(s)).not.toBe('');
    expect(requestStateText('weird')).toBe('weird');
  });
});
