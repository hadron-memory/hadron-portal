/**
 * #1226 — the user picker is a BOUNDED PREVIEW: it names how many matches it
 * shows and says when more exist, and a stale or failed search never leaves the
 * previous query's "more match" cue behind.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import type { SearchUserPage } from '$lib/users/search-user';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import EscapeHostHarness from '$lib/test/EscapeHostHarness.svelte';
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

// portal#1169 — the popup can be dismissed with a visible control and dims the
// page behind it.
describe('SelectUser modal chrome (#1169)', () => {
  it('has a Close button that dismisses the dialog', async () => {
    const props = reactiveProps<Record<string, unknown>>({ search: async () => ({ users: [], truncated: false }), onselect: () => {}, open: true });
    const m = mountComponent(SelectUser as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    const close = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Close');
    expect(close).toBeTruthy();
    close!.click();
    flushSync();
    await tick();
    expect(props.open).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('dims the page behind the dialog', () => {
    open(async () => ({ users: [], truncated: false }));
    const overlay = document.querySelector('[role="dialog"]')!.parentElement!;
    expect(overlay.className).toMatch(/bg-black\/\d+/);
  });

  it('dims more strongly in dark mode, where bg-black/30 barely shows (Cooper, #1233)', () => {
    open(async () => ({ users: [], truncated: false }));
    const overlay = document.querySelector('[role="dialog"]')!.parentElement!;
    expect(overlay.className).toMatch(/dark:bg-black\/\d+/);
  });
});

// portal#1169 / hadron-server#2179 — organizations in common with the found person.
describe('SelectUser shared organizations (#1169)', () => {
  const withOrgs = (id: string, sharedOrganizations: unknown) => ({ ...u(id), sharedOrganizations });
  async function show(users: unknown[]) {
    const m = open(async () => ({ users: users as never, truncated: false }));
    await find(m, 'abc');
  }

  it('lists the shared organizations with their URNs', async () => {
    await show([withOrgs('a', { items: [{ id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com' }], total: 1 })]);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Acme');
    expect(text.replace(/\s+/g, '')).toContain('hrn:org:acme.com');
  });

  it('says so when there are none in common, and distinguishes a withheld answer', async () => {
    await show([withOrgs('a', { items: [], total: 0 }), withOrgs('b', null)]);
    const text = document.body.textContent ?? '';
    expect(text).toContain('No organizations in common');
    expect(text).toContain('Not shown to you');
  });

  it('says how many more there are when the page is not the whole list', async () => {
    await show([withOrgs('a', { items: [{ id: 'o1', name: 'Acme', urn: 'hrn:org:acme.com' }], total: 4 })]);
    expect(document.body.textContent).toContain('and 3 more');
  });

  it('shows nothing about organizations when the server did not answer the field at all', async () => {
    await show([u('a')]);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Not shown to you');
    expect(text).not.toContain('in common');
  });
});

describe('SelectUser: Escape closes one layer only (#1584)', () => {
  const hostDialog = () => document.querySelector<HTMLElement>('[data-host-dialog]');
  const overlay = () => document.querySelector<HTMLElement>('.fixed.inset-0');

  function openInHost() {
    const m = mountComponent(EscapeHostHarness, {
      child: SelectUser,
      childProps: { search: async () => ({ users: [], truncated: false }), onselect: () => {}, open: true },
    });
    mounted.push(m);
    return m;
  }

  it('one Escape inside the picker closes the picker, not the host dialog around it', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above); // registered before the picker opened
    try {
      openInHost();
      await tick(2);
      expect(overlay()).not.toBeNull();
      const input = overlay()!.querySelector('input');
      input!.focus(); // a real press starts at the search box
      input!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      flushSync();
      expect(overlay()).toBeNull(); // exactly one layer closed: the picker's
      expect(hostDialog()).not.toBeNull(); // the host keeps its layer
      expect(above).not.toHaveBeenCalled(); // the earlier-registered listener never fired
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('Escape with focus outside the picker still closes it — the fallback, shielding the host', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above);
    try {
      openInHost();
      await tick(2);
      (document.activeElement as HTMLElement | null)?.blur?.(); // focus never entered the picker
      expect(document.activeElement).toBe(document.body);
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      flushSync();
      expect(overlay()).toBeNull();
      expect(hostDialog()).not.toBeNull();
      expect(above).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', above);
    }
  });
});
