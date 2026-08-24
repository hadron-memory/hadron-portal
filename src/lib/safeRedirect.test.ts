import { describe, it, expect } from 'vitest';
import { isLocalPath, safeRedirect, withQuery } from './safeRedirect';

describe('isLocalPath', () => {
  it('accepts same-origin local paths', () => {
    expect(isLocalPath('/')).toBe(true);
    expect(isLocalPath('/app/dashboard')).toBe(true);
    expect(isLocalPath('/browse?addMemory=abc')).toBe(true);
  });

  it('rejects open-redirect vectors', () => {
    expect(isLocalPath('https://evil.example/phish')).toBe(false);
    expect(isLocalPath('//evil.example')).toBe(false); // protocol-relative
    expect(isLocalPath('/\\evil.example')).toBe(false); // backslash → // in some browsers
    expect(isLocalPath('javascript:alert(1)')).toBe(false);
    expect(isLocalPath('app/dashboard')).toBe(false); // no leading slash
  });

  it('rejects nullish/empty', () => {
    expect(isLocalPath(null)).toBe(false);
    expect(isLocalPath(undefined)).toBe(false);
    expect(isLocalPath('')).toBe(false);
  });
});

describe('safeRedirect', () => {
  it('passes through safe local paths', () => {
    expect(safeRedirect('/app/memories/new')).toBe('/app/memories/new');
  });

  it('falls back for unsafe or missing targets', () => {
    expect(safeRedirect('https://evil.example')).toBe('/app/dashboard');
    expect(safeRedirect('//evil.example')).toBe('/app/dashboard');
    expect(safeRedirect(null)).toBe('/app/dashboard');
    expect(safeRedirect('/x', '/home')).toBe('/x');
    expect(safeRedirect('https://evil', '/home')).toBe('/home');
  });
});

// #761 — a redirect that rewrites the path must not discard the caller's state.
describe('withQuery', () => {
  it('appends a query string to a bare path', () => {
    expect(withQuery('/app/apps/a1', '?tab=chats&chat=chats:team')).toBe(
      '/app/apps/a1?tab=chats&chat=chats:team',
    );
  });

  it('leaves the path untouched when there is no query', () => {
    // URL.search is '' for a query-less URL — appending a bare '?' would put a
    // cosmetically different URL in the Location header for every plain visit.
    expect(withQuery('/app/apps/a1', '')).toBe('/app/apps/a1');
    expect(withQuery('/app/apps/a1', '?')).toBe('/app/apps/a1');
  });

  it('joins with & when the target already carries a query', () => {
    // canonicalPath returns bare paths today, so this branch guards a future
    // target that does not: `?a=b?c=d` is not two params, it is one param
    // whose value contains a '?'.
    expect(withQuery('/app/apps/a1?view=grid', '?tab=chats')).toBe(
      '/app/apps/a1?view=grid&tab=chats',
    );
  });

  it('preserves values that themselves contain URN colons and encoded chars', () => {
    // A `?chat=chats:team` deep link is the #744 case that found this defect;
    // the helper must not re-encode or split on the colon.
    expect(withQuery('/app/apps/a1', '?chat=chats:team&worklogRef=owner%2Frepo%23371')).toBe(
      '/app/apps/a1?chat=chats:team&worklogRef=owner%2Frepo%23371',
    );
  });
});
