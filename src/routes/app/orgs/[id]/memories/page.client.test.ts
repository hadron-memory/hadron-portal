/**
 * portal#2175 items 1 and 2 — the Personal Memories tab's badge branch and the
 * #555/#556 create-flow deep link, neither of which had a component test.
 *
 * Item 1: personalRows' badge picks per class — private → "Private", system →
 * "System" (#2140: the caller's own org-less system memory lands on this tab
 * too), anything else → "Personal". A badge that followed the wrong class
 * would mislabel the row's privacy on a list people trust for exactly that.
 *
 * Item 2: the create flow redirects an owner-only create back with
 * ?tab=personal (pinned in new/page.server.test.ts) and the loader turns that
 * into initialTab (pinned in page.server.test.ts). What only a mount can pin
 * is the last link: the page actually SELECTS the Personal Memories tab, and
 * the just-created row — the shape the loader's ownPrivate predicate passes
 * (class personal/private, this org, this user) — is visible there.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import {
  deleteOrgMemorySchema, orgMemorySubscribeSchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const mem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, urn: `hrn:mem:acme.com:${id}`, visibility: 'PRIVATE', source: null, readBranch: null,
  lastSyncedAt: null, vectorIndexEnabled: false, embeddingSource: null, ...extra,
});

async function mountMemories(initialTab: 'personal' | 'org', personalMemories: unknown[]) {
  setStubPage('https://example.test/app/orgs/org-1/memories', { id: 'org-1' });
  const [subscribeForm, deleteForm, syncAllForm, unsubscribeForm] = await Promise.all(
    [orgMemorySubscribeSchema, deleteOrgMemorySchema, syncOrgMemoriesSchema, unsubscribeOrgMemorySchema]
      .map((schema) => superValidate(zod4(schema as never), { errors: false })),
  );
  const m = mountComponent(Page as never, {
    data: {
      org: {
        id: 'org-1', name: 'Acme',
        memories: [mem('m1', 'Alpha Org Memory')],
        subscriptions: [],
      },
      systemMemories: [mem('sys1', 'Org System Core')],
      personalMemories,
      availableMemories: [],
      initialTab,
      subscribeForm, deleteForm, syncAllForm, unsubscribeForm,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target as HTMLElement;
}

const rowFor = (target: HTMLElement, id: string) =>
  target.querySelector<HTMLTableRowElement>(`a[href="/app/memories/${id}"]`)?.closest('tr') ?? null;

describe('Personal Memories tab — badges by class (portal#2175 item 1)', () => {
  it('labels a private row Private, an own org-less system row System, and a personal row Personal', async () => {
    const target = await mountMemories('personal', [
      mem('p-note', 'My Notes', { class: 'personal', userId: 'u1', organizationId: 'org-1' }),
      mem('p-diary', 'Secret Diary', { class: 'private', userId: 'u1', organizationId: 'org-1' }),
      mem('p-flow', 'flow-lab-system', { class: 'system', userId: null, organizationId: null }),
    ]);
    // Each row names its own privacy and no other: the words are distinct, so
    // the type cell's badge is pinned by what the row as a whole carries.
    const note = rowFor(target, 'p-note')!.textContent ?? '';
    const diary = rowFor(target, 'p-diary')!.textContent ?? '';
    const flow = rowFor(target, 'p-flow')!.textContent ?? '';
    expect(note).toContain('Personal');
    expect(note).not.toContain('Private');
    expect(note).not.toContain('System');
    expect(diary).toContain('Private');
    expect(diary).not.toContain('Personal');
    expect(diary).not.toContain('System');
    expect(flow).toContain('System');
    expect(flow).not.toContain('Personal');
    expect(flow).not.toContain('Private');
  });

  it('the badge chip is the amber personal-section palette on every personal row, whatever the class', async () => {
    const target = await mountMemories('personal', [
      mem('p-diary', 'Secret Diary', { class: 'private', userId: 'u1', organizationId: 'org-1' }),
      mem('p-flow', 'flow-lab-system', { class: 'system', userId: null, organizationId: null }),
    ]);
    // badgeClass() keeps the old card layout's per-section palette: every row on
    // this tab is amber, including the system-class one.
    for (const id of ['p-diary', 'p-flow']) {
      const badge = rowFor(target, id)!.querySelector('span.text-xs')!;
      expect(badge.className).toContain('bg-amber-100');
      expect(badge.className).toContain('text-amber-700');
    }
  });
});

describe('Personal Memories tab — the create-flow deep link (portal#2175 item 2, #555/#556)', () => {
  it('?tab=personal selects the Personal Memories tab, and the just-created row is visible there', async () => {
    // The row a fresh owner-only create produces: this org, this user, class
    // personal — exactly what the loader's ownPrivate predicate passes through.
    const target = await mountMemories('personal', [
      mem('p-new', 'Freshly Made', { class: 'personal', userId: 'u1', organizationId: 'org-1' }),
    ]);
    const selected = target.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain('Personal Memories');
    // The row landed on the tab the redirect targets…
    expect(rowFor(target, 'p-new')).not.toBeNull();
    // …and the org grid did not render behind it.
    expect(rowFor(target, 'm1')).toBeNull();
    expect(rowFor(target, 'sys1')).toBeNull();
  });

  it('without the hint the org grid renders instead, and no personal row is on it', async () => {
    const target = await mountMemories('org', [
      mem('p-new', 'Freshly Made', { class: 'personal', userId: 'u1', organizationId: 'org-1' }),
    ]);
    const selected = target.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain('Org Memories');
    expect(rowFor(target, 'm1')).not.toBeNull();
    expect(rowFor(target, 'sys1')).not.toBeNull();
    expect(rowFor(target, 'p-new')).toBeNull();
  });
});
