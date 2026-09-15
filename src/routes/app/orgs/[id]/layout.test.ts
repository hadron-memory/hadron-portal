/**
 * Org-detail header SSR (#729): the organization symbol, and the tab it is
 * scoped to.
 *
 * The mark itself is static markup, so the thing worth pinning is not that it
 * renders — it is WHERE. The caption block it lives in is Profile-only (#364),
 * and an icon hoisted out of that `{#if}` would put a building glyph next to
 * "Members" or "Usage", marking the wrong noun on every other tab. That is the
 * one way this change can go wrong silently, so it is asserted in both
 * directions.
 *
 * The assertions key on `data-testid="org-symbol"`, never on `<svg`: the URN
 * chip under the caption renders copy and link icons of its own, so a bare
 * `<svg` assertion passes with the org symbol deleted — a test that cannot fail
 * for the reason it was written (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';

// The layout reads `$page.url.pathname` to decide the active tab. Portal vitest
// skips the SvelteKit plugin, so the virtual module is mocked — and the
// pathname is the input under test here, so each case renders with its own.
const pathname = vi.hoisted(() => ({ value: '/app/orgs/org-1' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      get url() {
        return new URL(`https://example.test${pathname.value}`);
      },
      params: {},
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

import Layout from './+layout.svelte';

// A full `Organization`, not a cast partial: the layout's prop type is the real
// one, and a cast here would hide the next field this header learns to read.
const org = {
  id: 'org-1',
  name: 'Baragaun',
  urn: 'hrn:org:baragaun.com',
  githubInstallationId: null,
  githubAppId: null,
  hasGithubAppPrivateKey: false,
  createdAt: '1789430400000',
  updatedAt: '1789430400000',
};

// `LayoutData` here is the whole inherited chain — this layout's own `org` plus
// everything `app/+layout.server.ts` puts in front of it. Built out in full
// rather than cast: a cast satisfies the compiler by switching it off, and the
// next field this header learns to read would then arrive undefined at runtime
// with the suite still green.
const user = {
  id: 'user-1',
  handle: 'holger',
  githubUsername: null,
  name: 'Holger',
  avatarUrl: null,
  roles: [] as string[],
};

const children = createRawSnippet(() => ({ render: () => '<div>tab body</div>' }));

function renderAt(path: string, isConsumerMode = false) {
  pathname.value = path;
  return render(Layout, {
    props: {
      data: {
        user,
        activeOrgId: org.id,
        activeOrg: org,
        navOrgs: [org],
        impersonation: null,
        isConsumerMode,
        org,
      },
      children,
    },
  }).body;
}

describe('org-detail header symbol (#729)', () => {
  it('marks the org with the organization symbol on the Profile tab', () => {
    const html = renderAt('/app/orgs/org-1');
    expect(html).toContain('data-testid="org-symbol"');
    // Beside the caption it is a second rendering of, not instead of it.
    expect(html).toContain('Organization:');
    expect(html).toContain('Baragaun');
  });

  it('hides it behind aria-hidden, since the caption already says the word', () => {
    const html = renderAt('/app/orgs/org-1');
    const symbol = html.slice(html.indexOf('data-testid="org-symbol"'));
    expect(symbol.slice(0, symbol.indexOf('>'))).toContain('aria-hidden="true"');
  });

  it('lets the icon keep its size and a long org name break instead of overflowing', () => {
    // `min-w-0 break-words` is one remedy in two classes and NEITHER half
    // works alone — measured at 375px with a 51-char unbroken name, either
    // one on its own leaves 377px of horizontal overflow and both together
    // leave 18px (a pre-existing tab-strip overflow, not this header). So
    // both are asserted: dropping either is the bug coming back.
    // hrn:node:hadronmemory.com:hadron-portal:review:content-sized-control-needs-min-w-0.
    const html = renderAt('/app/orgs/org-1');
    const symbol = html.slice(html.indexOf('data-testid="org-symbol"'));
    expect(symbol.slice(0, symbol.indexOf('>'))).toContain('shrink-0');
    // Pinned by ADJACENCY to the caption it wraps, not by a bare
    // `toContain('min-w-0')` — that passes on the class appearing anywhere in
    // the document, including on some unrelated element, which is not the
    // thing being protected. It is the flex CHILD that must be able to shrink;
    // the same classes on the h1 itself do nothing for the row inside it.
    expect(html).toContain('<span class="min-w-0 break-words"><span class="font-normal');
  });

  it.each([
    ['/app/orgs/org-1/members', 'Team'],
    ['/app/orgs/org-1/integrations', 'Integrations'],
    ['/app/orgs/org-1/sessions', 'Usage'],
  ])('does NOT mark %s, where the heading is %s and not the org', (path) => {
    const html = renderAt(path);
    // The tab bar is still there, so this is the header block being absent
    // rather than the whole layout failing to render.
    expect(html).toContain('Organization sections');
    expect(html).not.toContain('data-testid="org-symbol"');
  });

  it('does not mark a deep sub-route that brings its own chrome', () => {
    // e.g. /memories, /apps/[appId] — no tab matches, so no header at all.
    const html = renderAt('/app/orgs/org-1/apps/app-1');
    expect(html).not.toContain('data-testid="org-symbol"');
    expect(html).toContain('tab body');
  });

  it('marks the org for a consumer-mode user, whose only tab IS Profile', () => {
    const html = renderAt('/app/orgs/org-1', true);
    expect(html).toContain('data-testid="org-symbol"');
    // Consumer mode has a single tab, so the tab bar is suppressed — the
    // symbol must not have been riding on that chrome.
    expect(html).not.toContain('Organization sections');
  });
});
