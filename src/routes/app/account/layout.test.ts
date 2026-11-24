/**
 * Account layout extension tabs (C2, #2568). The account strip is one shared
 * TabRow; an extension tab is appended and matched with the shared helper.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';

const pathname = vi.hoisted(() => ({ value: '/app/account' }));
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

import type { PortalExtension } from '$lib/ext/types';
const fx = vi.hoisted(() => ({ exts: [] as unknown[] }));
vi.mock('$lib/ext/registry', async (orig) => {
  const real = await orig<typeof import('$lib/ext/registry')>();
  return {
    ...real,
    extensionAccountNavTabs: (c: Parameters<typeof real.extensionAccountNavTabs>[0]) =>
      real.extensionAccountNavTabs(c, fx.exts as PortalExtension[]),
  };
});

import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<div>tab body</div>' }));
const fixture: PortalExtension = {
  id: 'fx',
  accountTabs: (c) => [{ id: 'fx', label: 'Fixture', href: `${c.basePath}/fx`, match: 'prefix' }],
};

function links(path: string): Array<[string, boolean]> {
  pathname.value = path;
  const html = render(Layout, { props: { children } }).body;
  // The visible row only: the off-layout measuring copy has no href.
  const row = html.slice(html.indexOf('Account sections'));
  return [...row.matchAll(/<a\b([^>]*href="[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => [
    m[2].replace(/<[^>]*>/g, '').trim(),
    m[1].includes('aria-current="page"'),
  ]);
}

describe('account layout extension tabs (C2, #2568)', () => {
  it('shows the extension tab last and current on its own path', () => {
    fx.exts = [fixture];
    expect(links('/app/account/fx').at(-1)).toEqual(['Fixture', true]);
  });

  it('keeps it current on a path below it', () => {
    fx.exts = [fixture];
    expect(links('/app/account/fx/deeper').at(-1)).toEqual(['Fixture', true]);
  });

  it('falls back to Account, not the extension, on a sibling sharing the prefix', () => {
    fx.exts = [fixture];
    const l = links('/app/account/fx-x');
    expect(l.find(([, cur]) => cur)?.[0]).toBe('Account');
  });

  it('with no extension the labels are today\'s, in order', () => {
    fx.exts = [];
    expect(links('/app/account').map(([l]) => l)).toEqual([
      'Account', 'Organization', 'Node-role templates', 'Invite', 'API Keys', 'Grants',
    ]);
  });

  it('renders a fixture tab whose id is "account" beside the built-in (C2-R1)', () => {
    fx.exts = [{ id: 'fx', accountTabs: (c: { basePath: string }) => [{ id: 'account', label: 'Mine', href: `${c.basePath}/fx` }] }];
    const labels = links('/app/account').map(([l]) => l);
    expect(labels.at(-1)).toBe('Mine');
    expect(labels.filter((l) => l === 'Account')).toHaveLength(1);
  });
});
