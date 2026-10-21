/**
 * #1226 — the user picker is a BOUNDED PREVIEW: it names how many matches it
 * shows and says when more exist, and a stale or failed search never leaves the
 * previous query's "more match" cue behind.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import type { SearchUserPage } from '$lib/users/search-user';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import SelectUser from './SelectUser.svelte';

const u = (id: string) => ({ id, handle: id, urn: null, githubUsername: null, avatarUrl: null, emailMasked: null });
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

function open(search: (q: string) => Promise<SearchUserPage>) {
  const props = reactiveProps<Record<string, unknown>>({ search, onselect: () => {}, open: true });
  const m = mountComponent(SelectUser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}
async function find(m: Mounted<Record<string, unknown>>, q: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  document.querySelector<HTMLFormElement>('form')!.requestSubmit();
  for (let i = 0; i < 5; i++) await tick();
}
const footer = () => document.body.textContent ?? '';

describe('SelectUser bounded preview (#1226)', () => {
  it('says more match when the server holds more than it returned', async () => {
    const m = open(async () => ({ users: [u('a'), u('b')], truncated: true }));
    await find(m, 'abc');
    expect(footer()).toContain('2 results shown; more match. Narrow your search.');
  });

  it('says nothing about more when the page is complete', async () => {
    const m = open(async () => ({ users: [u('a')], truncated: false }));
    await find(m, 'abc');
    expect(footer()).toContain('1 result');
    expect(footer()).not.toContain('more match');
  });

  it('a failed later search does not keep the earlier "more match" cue', async () => {
    let n = 0;
    const m = open(async () => {
      if (n++ === 0) return { users: [u('a')], truncated: true };
      throw new Error('boom');
    });
    await find(m, 'abc');
    expect(footer()).toContain('more match');
    await find(m, 'abcd');
    expect(footer()).toContain('Search failed');
    expect(footer()).not.toContain('more match');
  });

  it('a search that resolves after the modal closed repopulates nothing', async () => {
    let release!: (p: SearchUserPage) => void;
    const m = open(() => new Promise<SearchUserPage>((r) => { release = r; }));
    await find(m, 'abc');
    m.props.open = false;
    flushSync();
    await tick();
    release({ users: [u('late')], truncated: true });
    for (let i = 0; i < 5; i++) await tick();
    m.props.open = true;
    flushSync();
    await tick();
    // Reopened: a fresh picker, not the late answer to a search the user abandoned.
    expect(footer()).not.toContain('late');
    expect(footer()).not.toContain('more match');
  });
});
