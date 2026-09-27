/**
 * #919 / @codex on #930 — SvelteKit reuses the profile page across
 * /app/user URLs. The Workers grid must not carry one profile's search into
 * the next, where it can hide every row. Pinned both ways: the keyed grid
 * resets, and (checked by mutation) an unkeyed one does not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const worker = (id: string, name: string) => ({
  id, name, urn: null, role: 'r', appId: 'a', appUrn: 'hrn:app:acme.com:team',
  heldAt: null, hasLiveSession: true, lastActiveAt: null,
});
const data = (userId: string, handle: string, workers: unknown[]) => ({
  user: { id: userId, handle, urn: null, githubUsername: null, avatarUrl: null },
  heldWorkers: { ok: true, items: workers },
});

const names = (t: HTMLElement) => [...t.querySelectorAll('tbody a[href^="/app/workers/"]')].map((a) => a.textContent?.trim());

describe('profile page — switching profiles resets the Workers grid', () => {
  it('drops the previous profile\'s search, so the next profile\'s workers show', async () => {
    const props = reactiveProps<{ data: unknown }>({ data: data('user-a', 'alice', [worker('w1', 'Iris')]) });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const box = () => m.target.querySelector<HTMLInputElement>('input[aria-label="Search the workers this user holds"]')!;
    box().value = 'iris';
    box().dispatchEvent(new Event('input', { bubbles: true }));
    await tick(3);
    expect(names(m.target)).toEqual(['team/Iris']);

    props.data = data('user-b', 'bob', [worker('w2', 'Dara')]);
    await tick(4);
    expect(box().value).toBe('');
    expect(names(m.target)).toEqual(['team/Dara']);
  });
});
