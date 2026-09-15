/**
 * #668 / @codex P1 on #839 — the Sharing TAB is gated on the same predicate as
 * the page it leads to.
 *
 * Caught by a mutation, not by review: with the page gate fixed and this test
 * absent, reverting the layout to offer the tab to everyone left the whole
 * suite green. The page would then explain itself correctly to a stranger who
 * clicked — but the portal would still be advertising a tab whose only honest
 * content is "you cannot see this".
 *
 * The two gates must not drift apart, so both call `canManageShares` and both
 * are pinned in both directions.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';

const pathname = vi.hoisted(() => ({ value: '/app/memories/mem-1/info' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      get url() {
        return new URL(`https://example.test${pathname.value}`);
      },
      params: { id: 'mem-1' },
      route: { id: null }, status: 200, error: null, data: {}, form: null,
    }),
  };
});
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

import Layout from './+layout.svelte';

const SHARING_TAB = `href="/app/memories/mem-1/share"`;

const OWNER = { id: 'owner-1', handle: 'holger', name: 'Holger', githubUsername: null, avatarUrl: null, roles: [] as string[] };
const STRANGER = { ...OWNER, id: 'someone-else' };

function renderLayout(opts: {
  user?: typeof OWNER;
  memoryClass?: string;
  userId?: string | null;
}) {
  const graph = {
    id: 'mem-1',
    name: 'Notes',
    urn: 'hrn:mem:acme.com:notes',
    class: opts.memoryClass ?? 'personal',
    userId: opts.userId === undefined ? 'owner-1' : opts.userId,
    organizationId: null,
    isEncrypted: false,
    tags: [],
  };
  return render(Layout, {
    props: {
      data: { graph, org: null, user: opts.user ?? OWNER } as never,
      children: createRawSnippet(() => ({ render: () => '<div>tab body</div>' })),
    } as never,
  }).body;
}

describe('#668 Sharing tab visibility', () => {
  it('offers it to the memory’s principal', () => {
    expect(renderLayout({})).toContain(SHARING_TAB);
  });

  it('withholds it from anyone else — the #839 P1', () => {
    const html = renderLayout({ user: STRANGER });
    expect(html).not.toContain(SHARING_TAB);
    // The rest of the tab strip is intact, so this is the Sharing tab being
    // withheld rather than the layout failing to render.
    expect(html).toContain(`href="/app/memories/mem-1/settings"`);
  });

  it('offers it to a platform admin, mirroring the resolver', () => {
    expect(renderLayout({ user: { ...STRANGER, roles: ['ADMIN'] } })).toContain(SHARING_TAB);
  });

  it('withholds it on a system memory even from the principal (#755 shape)', () => {
    const html = renderLayout({ memoryClass: 'system' });
    expect(html).not.toContain(SHARING_TAB);
  });

  it('withholds it on an org-owned memory, which has no principal to be', () => {
    // `userId: null` — the org-admin fallback does not apply to shares, since
    // shares exist only on personal (user-owned) memories.
    const html = renderLayout({ userId: null, memoryClass: 'knowledge' });
    expect(html).not.toContain(SHARING_TAB);
  });
});
