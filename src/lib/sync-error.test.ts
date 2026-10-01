import { describe, expect, it } from 'vitest';
import { redactCredentials, syncErrorView } from './sync-error';

describe('redactCredentials (#988)', () => {
  it('strips userinfo from a tokenized git URL', () => {
    expect(redactCredentials('clone -- https://x-access-token:ghs_abcdefghijklmnopqrstuv@github.com/a/b.git /tmp'))
      .toBe('clone -- https://***@github.com/a/b.git /tmp');
  });
  it('strips any scheme’s user:password', () => {
    expect(redactCredentials('ssh://deploy:hunter2@host/x and http://u@h/y')).toBe('ssh://***@host/x and http://***@h/y');
  });
  it('strips a bare x-access-token value and GitHub token shapes', () => {
    expect(redactCredentials('x-access-token:abc123 then ghp_0123456789abcdefABCDEF and github_pat_11ABCDEFG0123456789_xyz'))
      .toBe('x-access-token:*** then *** and ***');
  });
  it('leaves ordinary text and URLs without credentials alone', () => {
    const s = 'fatal: Remote branch nope not found in https://github.com/acme/repo.git';
    expect(redactCredentials(s)).toBe(s);
  });
});

describe('syncErrorView (#988)', () => {
  it('names the review hold by its code', () => {
    expect(syncErrorView('GIT_SYNC_REVIEW_REQUIRED: 2 repo-owned node(s) …')).toEqual({ kind: 'review-required' });
  });
  it('redacts any other reason', () => {
    expect(syncErrorView('boom https://x-access-token:SECRET@github.com/a/b')).toEqual({ kind: 'other', detail: 'boom https://***@github.com/a/b' });
  });
  it('has no detail for an empty or missing reason', () => {
    expect(syncErrorView(null)).toEqual({ kind: 'other', detail: null });
    expect(syncErrorView('  ')).toEqual({ kind: 'other', detail: null });
  });
});
