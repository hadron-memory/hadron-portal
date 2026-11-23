/**
 * #1407 — the page's team-chat view cache is keyed by the team filter.
 *
 * Switching filter A -> B -> A on the REAL App page must never put A's cached
 * transcript rows into B's thread. The thread restores its saved window from
 * `channelViews[teamViewKey]`, and the key carries the filter; a key that
 * ignores it makes B open on A's rows and merge B's read into them. The
 * component-level reset is pinned elsewhere; only the page owns this key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import { resetKitAppliedResults } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';
import { message, pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetKitAppliedResults();
  window.history.replaceState({}, '', '/');
});

type Data = Awaited<ReturnType<typeof pageData>>;
const row = (seq: number, body: string) => ({ ...message(seq, 'w1'), body });

describe('team chat view cache across filters (#1407)', () => {
  it('A -> B -> A -> C -> B: no filter ever shows another filter\'s rows', async () => {
    setStubPage('http://localhost/app/apps/a1?tab=chats', { appId: 'a1' });
    const base = await pageData();
    const filtered = (head: string, rows: ReturnType<typeof row>[]) => ({
      ...base, initialTab: 'chats', teamChatMessages: rows, teamChatTotal: rows.length,
      teamFilter: { kind: 'teams', headRefs: [head] },
    }) as unknown as Data;
    const A = filtered('head-a', [row(1, 'alpha one'), row(2, 'alpha two')]);
    const B = filtered('head-b', [row(3, 'beta three')]);
    const C = filtered('head-c', [row(4, 'gamma four')]);

    const props = reactiveProps<Record<string, unknown>>({ data: A, form: null });
    page.update((p) => ({ ...p, data: A }));
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(3);
    const show = async (data: Data) => {
      page.update((p) => ({ ...p, data }));
      flushSync(() => { props.data = data; });
      await tick(3);
    };
    const text = () => m.target.textContent ?? '';

    expect(text()).toContain('alpha one');
    expect(text()).not.toContain('beta three');

    await show(B);
    expect(text()).toContain('beta three');
    expect(text()).not.toContain('alpha one');
    expect(text()).not.toContain('alpha two');

    await show(A);
    expect(text()).toContain('alpha one');
    expect(text()).toContain('alpha two');
    expect(text()).not.toContain('beta three');

    // A third filter is the sharper case: whatever the cache holds from the
    // last two switches must not seed it.
    await show(C);
    expect(text()).toContain('gamma four');
    expect(text()).not.toContain('alpha');
    expect(text()).not.toContain('beta');
    await show(B);
    expect(text()).toContain('beta three');
    expect(text()).not.toContain('alpha');
    expect(text()).not.toContain('gamma');
  });
});
