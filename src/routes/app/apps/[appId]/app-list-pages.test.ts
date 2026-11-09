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
  // #1868: Previous steps by the page size, not the served count — even a
  // raced short page returns to the aligned window (here offset 0, whose
  // href drops the param), never offset 13.
  expect(new URL(page.previousHref!, url).searchParams.get('worklogOffset')).toBe(null);
});
// #1868 — Celine's exact repro: 41 records, short last page of 1. Previous
// must return to the page the user came from (offset 20), and from there to
// the start — two clicks back, with 21–40 seen again on the way.
it('Previous from a short last page steps by the page size back to the aligned window', () => {
  const url = new URL('https://example.test/app/apps/a');
  const tail = appListNavigation(url, 'worklogOffset', 'worklog', 40, 1, 41);
  expect(new URL(tail.previousHref!, url).searchParams.get('worklogOffset')).toBe('20');
  const back = appListNavigation(url, 'worklogOffset', 'worklog', 20, 20, 41);
  expect(new URL(back.previousHref!, url).searchParams.get('worklogOffset')).toBe(null); // offset 0 drops the param
  // The same step from a now-empty old page (everything on it deleted):
  // count plays no part in the step, so the route back is unchanged.
  const empty = appListNavigation(url, 'worklogOffset', 'worklog', 40, 0, 41);
  expect(new URL(empty.previousHref!, url).searchParams.get('worklogOffset')).toBe('20');
  // A hand-edited offset inside the first window clamps to the start —
  // never a negative param for appListOffset to silently heal.
  const shallow = appListNavigation(url, 'worklogOffset', 'worklog', 7, 7, 41);
  expect(new URL(shallow.previousHref!, url).searchParams.get('worklogOffset')).toBe(null);
});
it('stops at total or no progress, with a route back from a now-empty old page', () => {
  const url = new URL('https://example.test/app/apps/a');
  expect(appListNavigation(url, 'configOffset', 'ai-configs', 20, 1, 21).nextHref).toBeNull();
  const empty = appListNavigation(url, 'configOffset', 'ai-configs', 40, 0, 1);
  expect(empty.nextHref).toBeNull();
  expect(empty.total).toBe(1);
  expect(empty.firstHref).toBe('/app/apps/a?tab=ai-configs');
});

it('retains a forward probe when a full page races a lagging count', () => {
  const page = appListNavigation(new URL('https://example.test/app/apps/a'), 'worklogOffset', 'worklog', 0, 20, 19);
  expect(page.total).toBe(20);
  expect(page.nextHref).toContain('worklogOffset=20');
});

// #1875 records existing race-only behavior, not a history-retrace promise.
// The fixed requested page size is 20; these simulated raced responses serve
// only 7 rows, with 41 reported total. Next adds the 7 served rows. Previous
// uses max(0, offset - 20): from 14 it returns 0, skipping the visited 7.
// That skip is explicitly accepted by the #1868/#1875 gates for this bounded
// race case, not proposed here as ideal UX or a bidirectional-history contract.
// The server code review for #1875 found no stable short non-terminal serve
// on these two reads. This pin changes neither the pager nor that contract.
it.each([
  ['worklogOffset', 'worklog', 'configOffset'],
  ['configOffset', 'ai-configs', 'worklogOffset'],
] as const)('%s records the accepted race trace 0 → 7 → 14 → Previous → 0 (skips visited 7)', (key, tab, otherKey) => {
  let url = new URL(`https://example.test/app/apps/a?${otherKey}=40&worklogRef=a%23b`);
  const visited = [appListOffset(url.searchParams, key)];
  for (const expected of [7, 14]) {
    const page = appListNavigation(url, key, tab, visited.at(-1)!, 7, 41);
    expect(page.nextHref).not.toBeNull();
    url = new URL(page.nextHref!, url);
    const offset = appListOffset(url.searchParams, key);
    expect(offset).toBe(expected);
    visited.push(offset);
    expect(url.searchParams.get(otherKey)).toBe('40');
    expect(url.searchParams.get('worklogRef')).toBe('a#b');
    expect(url.searchParams.get('tab')).toBe(tab);
  }
  const previous = appListNavigation(url, key, tab, visited.at(-1)!, 7, 41);
  expect(previous.previousHref).not.toBeNull();
  const back = new URL(previous.previousHref!, url);
  visited.push(appListOffset(back.searchParams, key));
  expect(visited).toEqual([0, 7, 14, 0]);
  expect(back.searchParams.has(key)).toBe(false);
  expect(back.searchParams.get(otherKey)).toBe('40');
  expect(back.searchParams.get('worklogRef')).toBe('a#b');
  expect(back.searchParams.get('tab')).toBe(tab);
});
