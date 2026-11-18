/**
 * #998: the account page shows the signed-in user's URN, through the standard
 * Urn component, under the avatar in place of the bare `@handle`. The URN is
 * what a reader copies into a CLI, an MCP call or a message; a handle alone is
 * not addressable (hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const base = { id: 'u1', name: 'Ada', handle: 'ada', email: 'ada@example.com', githubUsername: null, avatarUrl: null };
const profileForm = {
  id: 'f1', valid: true, posted: false, errors: {}, constraints: {},
  data: { name: 'Ada', handle: 'ada', email: 'ada@example.com' },
};

function show(user: Record<string, unknown>) {
  const m = mountComponent(Page as never, { data: { user, form: profileForm }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

/** Elements whose own text is exactly `@ada`. */
const atHandle = (t: HTMLElement) => [...t.querySelectorAll('p, span')].filter((el) => el.textContent?.trim() === '@ada');

describe('Account page — the user URN (#998)', () => {
  it('shows the URN through the Urn component under the name', () => {
    const t = show({ ...base, urn: 'hrn:user:ada' });
    const urn = t.querySelector('[title="hrn:user:ada"]');
    expect(urn).not.toBeNull();
    // Copyable like every other URN: the component's own copy control.
    expect(t.querySelector('button[aria-label]')).not.toBeNull();
    // Under the avatar, beside the name: the same block as the name line.
    const name = [...t.querySelectorAll('p')].find((p) => p.textContent?.trim() === 'Ada')!;
    expect(name.parentElement!.contains(urn)).toBe(true);
  });

  it('no longer shows the bare @handle under the name; the Handle row keeps it', () => {
    const t = show({ ...base, urn: 'hrn:user:ada' });
    const hits = atHandle(t);
    expect(hits).toHaveLength(1);
    expect(hits[0].parentElement!.textContent).toContain('Handle');
  });

  it('renders no chip at all for a user without a URN (a handle-less user has none)', () => {
    const t = show({ ...base, handle: null, urn: null });
    expect(t.querySelector('[title^="hrn:"]')).toBeNull();
  });
});
