/**
 * portal#2175 items 1–3 — the Personal Memories tab's badge branch, the
 * #555/#556 create-flow deep link, and the degraded-read unavailable copy,
 * none of which had a component test.
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
 *
 * Item 3 (FIT 6884373873 c): a failed read keeps its rows hidden but the tab
 * never claims "no memories" — see the degraded describe block below.
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

async function mountMemories(
  initialTab: 'personal' | 'org',
  personalMemories: unknown[],
  degraded: {
    systemMemoriesDegraded?: boolean;
    personalMemoriesDegraded?: boolean;
    availableMemoriesDegraded?: boolean;
  } = {},
) {
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
      ...degraded,
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
    // The type cell's badge is exactly the class word — each row names its own
    // privacy and no other.
    const badge = (id: string) => rowFor(target, id)!.querySelector('[data-testid="row-type-badge"]')!.textContent;
    expect(badge('p-note')).toBe('Personal');
    expect(badge('p-diary')).toBe('Private');
    expect(badge('p-flow')).toBe('System');
  });

  it('the badge chip is the amber personal-section palette on every personal row, whatever the class', async () => {
    const target = await mountMemories('personal', [
      mem('p-diary', 'Secret Diary', { class: 'private', userId: 'u1', organizationId: 'org-1' }),
      mem('p-flow', 'flow-lab-system', { class: 'system', userId: null, organizationId: null }),
    ]);
    // badgeClass() keeps the old card layout's per-section palette: every row on
    // this tab is amber, including the system-class one.
    for (const id of ['p-diary', 'p-flow']) {
      const badge = rowFor(target, id)!.querySelector('[data-testid="row-type-badge"]')!;
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

// portal#2175 (FIT 6884373873 c) — the acceptance's "a failed ownership read
// … never renders as 'no memories'". The loader pins the flags
// (page.server.test.ts); only a mount pins what the reader actually sees: a
// flagged tab trades its empty-state copy for truthful unavailable copy. The
// false-empty this replaces — "No personal memories yet." over a hidden-by-
// failure list — was the review finding on this slice.
describe('A degraded read never reads as an empty list (portal#2175)', () => {
  it('a flagged personal tab renders the unavailable alert, not the false "No personal memories yet."', async () => {
    const target = await mountMemories('personal', [], { personalMemoriesDegraded: true });
    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load your personal memories");
    expect(target.textContent).not.toContain('No personal memories yet.');
  });

  it('the unflagged control still renders the empty copy — the alert is failure-driven, not unconditional', async () => {
    const target = await mountMemories('personal', []);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.textContent).toContain('No personal memories yet.');
  });

  it('a flagged tab with surviving rows shows the alert AND those rows — fail-closed hides only the failed read\'s rows', async () => {
    const target = await mountMemories(
      'personal',
      [mem('p-ok', 'Survivor', { class: 'personal', userId: 'u1', organizationId: 'org-1' })],
      { personalMemoriesDegraded: true },
    );
    expect(target.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load your personal memories");
    expect(rowFor(target, 'p-ok')).not.toBeNull();
  });

  // The helper's org fixture always carries a surviving org row (m1), so this
  // pins the flagged ORG tab's alert — the org-tab copy — above rows the org
  // read did return. The empty-copy suppression itself is pinned on the
  // personal tab above, where the fixture can be genuinely empty; both tabs
  // render through the same {:else if} chain.
  it('a flagged org tab renders its unavailable alert above the rows that survived', async () => {
    const target = await mountMemories('org', [], { systemMemoriesDegraded: true });
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load this organization's memories",
    );
    expect(rowFor(target, 'm1')).not.toBeNull();
  });
});
