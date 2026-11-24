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
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// C2 (#2568): the layout reads extension tabs through the registry. Mocked in
// BOTH directions (a hoisted holder), so these cases hold in a tree where a real
// extension is installed too, and never lean on the public tree having none.
import type { PortalExtension } from '$lib/ext/types';
const fx = vi.hoisted(() => ({ exts: [] as PortalExtension[], orgTabsSpy: vi.fn() }));
vi.mock('$lib/ext/registry', async (orig) => {
  const real = await orig<typeof import('$lib/ext/registry')>();
  return {
    ...real,
    extensionOrgNavTabs: (c: Parameters<typeof real.extensionOrgNavTabs>[0]) =>
      real.extensionOrgNavTabs(c, fx.exts),
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

function renderAt(path: string, isConsumerMode = false, role: string = 'OWNER') {
  pathname.value = path;
  return render(Layout, {
    props: {
      data: {
        user,
        activeOrgId: org.id,
        activeOrg: org,
        navOrgs: [{ ...org, members: [{ id: 'm1', role, canInvite: false, createdAt: '1789430400000', user: { ...user } }] }],
        nodeAdvice: [],
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

  it('keeps shrink-0 on the icon and BOTH halves of the min-w-0 + break-words remedy', () => {
    // `min-w-0 break-words` is one remedy in two classes and NEITHER half
    // works alone — measured at 375px with a 51-char unbroken name, either
    // one on its own leaves 377px of horizontal overflow and both together
    // leave 18px (a pre-existing tab-strip overflow, not this header). So
    // both are asserted: dropping either is the bug coming back.
    // hrn:node:hadronmemory.com:hadron-portal:review:content-sized-control-needs-min-w-0.
    //
    // This test pins the CLASS CONTRACT, and its name says so rather than
    // promising the overflow behaviour itself — because NEITHER lane can
    // check that. `node` renders to an HTML string with no box model, and
    // jsdom has no layout engine: `clientWidth`, `scrollWidth`, `offsetWidth`
    // and `getBoundingClientRect().width` all measure 0 there (probed on
    // this tree, not recalled). So a longer fixture name would read like an
    // overflow test and assert exactly what this one does — the shape
    // hrn:node:hadronmemory.com:hadron-portal:review:comment-cannot-enforce-a-per-instance-rule
    // warns about, a check that looks like it ran. The overflow evidence is the browser
    // measurement in the comment above and on PR #836; this is its
    // regression pin.
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

// ── C2 (#2568): extension tabs in the org strip ────────────────────────────
const fixture: PortalExtension = {
  id: 'fx',
  orgTabs(ctx) {
    fx.orgTabsSpy(ctx);
    if (ctx.viewerOrgRole !== 'OWNER' && ctx.viewerOrgRole !== 'ADMIN') return [];
    return [{ id: 'fx', label: 'Fixture', href: `${ctx.basePath}/fx`, match: 'prefix' }];
  },
};

/** The strip's links, in order: [label, current?]. */
function strip(html: string): Array<[string, boolean]> {
  const from = html.indexOf('Organization sections');
  if (from < 0) return [];
  const nav = html.slice(from, html.indexOf('</nav>', from));
  return [...nav.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map((m) => [m[2], m[1].includes('aria-current="page"')]);
}

describe('org layout extension tabs (C2, #2568)', () => {
  beforeEach(() => {
    fx.exts = [];
  });

  it('shows the extension tab last, current on its own path, with the tab bar', () => {
    fx.exts = [fixture];
    const html = renderAt('/app/orgs/org-1/fx');
    const links = strip(html);
    expect(links.at(-1)).toEqual(['Fixture', true]);
    expect(links.filter(([, cur]) => cur)).toHaveLength(1);
  });

  it('keeps it current, with the chrome, on a path below it (prefix)', () => {
    fx.exts = [fixture];
    const html = renderAt('/app/orgs/org-1/fx/deeper');
    expect(strip(html).at(-1)).toEqual(['Fixture', true]);
    expect(html).toContain('Organizations');
  });

  it('does not mark it current on a sibling that only shares the prefix', () => {
    fx.exts = [fixture];
    const html = renderAt('/app/orgs/org-1/fx-x');
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('Organization sections');
    expect(html).toContain('tab body');
  });

  it('reads the viewer role from navOrgs: a READER does not see it', () => {
    fx.exts = [fixture];
    const html = renderAt('/app/orgs/org-1/members', false, 'READER');
    expect(strip(html).map(([l]) => l)).not.toContain('Fixture');
  });

  it('does not ask an extension for tabs in consumer mode', () => {
    fx.exts = [fixture];
    fx.orgTabsSpy.mockClear();
    const html = renderAt('/app/orgs/org-1', true);
    expect(html).not.toContain('Fixture');
    expect(fx.orgTabsSpy).not.toHaveBeenCalled();
  });

  it('with no extension the labels are today\'s, in order', () => {
    fx.exts = [];
    expect(strip(renderAt('/app/orgs/org-1')).map(([l]) => l)).toEqual([
      'Profile', 'Team', 'Integrations', 'Channels', 'Node-role templates', 'Usage',
    ]);
  });

  it('renders a fixture tab whose id is "profile" beside the built-in Profile (C2-R1)', () => {
    fx.exts = [{ id: 'fx', orgTabs: (c: { basePath: string }) => [{ id: 'profile', label: 'Mine', href: `${c.basePath}/fx` }] }];
    const links = strip(renderAt('/app/orgs/org-1'));
    expect(links.at(-1)).toEqual(['Mine', false]);
    // Unnamespaced, both tabs share the id "profile" and BOTH read as current.
    expect(links.filter(([, cur]) => cur)).toEqual([['Profile', true]]);
  });
});
