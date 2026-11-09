import { expect, it } from 'vitest';
import { appListNavigation, appListOffset } from './app-list-pages';
it('rejects malformed or out-of-Int offsets before a read', () => {
  for (const raw of ['-1', '1.5', 'Infinity', '2147483648', '9007199254740993']) {
    expect(appListOffset(new URLSearchParams({ configOffset: raw }), 'configOffset')).toBe(0);
  }
  expect(appListOffset(new URLSearchParams('configOffset=40'), 'configOffset')).toBe(40);
});
it('continues after the actual served count, preserving independent filters and offsets', () => {
  const url = new URL('https://example.test/app/apps/a?worklogRef=a%23b&configOffset=20');
  const page = appListNavigation(url, 'worklogOffset', 'worklog', 20, 7, 41);
  const next = new URL(page.nextHref!, url);
  expect(next.searchParams.get('worklogOffset')).toBe('27');
  expect(next.searchParams.get('worklogRef')).toBe('a#b');
  expect(next.searchParams.get('configOffset')).toBe('20');
  expect(next.searchParams.get('tab')).toBe('worklog');
  expect(new URL(page.previousHref!, url).searchParams.get('worklogOffset')).toBe('13');
});
it('stops at total or no progress, with a route back from a now-empty old page', () => {
  const url = new URL('https://example.test/app/apps/a');
  expect(appListNavigation(url, 'configOffset', 'ai-configs', 20, 1, 21).nextHref).toBeNull();
  const empty = appListNavigation(url, 'configOffset', 'ai-configs', 40, 0, 1);
  expect(empty.nextHref).toBeNull();
  expect(empty.firstHref).toBe('/app/apps/a?tab=ai-configs');
});

it('retains a forward probe when a full page races a lagging count', () => {
  const page = appListNavigation(new URL('https://example.test/app/apps/a'), 'worklogOffset', 'worklog', 0, 20, 19);
  expect(page.total).toBe(20);
  expect(page.nextHref).toContain('worklogOffset=20');
});
