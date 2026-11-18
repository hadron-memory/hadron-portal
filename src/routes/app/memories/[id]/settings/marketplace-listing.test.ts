/**
 * #841 — the marketplace-listing control on the memory Settings tab.
 *
 * `Memory.listedOnMarketplace` had no control on any product surface, so the
 * catalogue could never be populated. These pins hold the RENDER side of the
 * fix: where the card sits, who it is offered to, and what it says about the
 * visibility interplay (`hrn:node:hadronmemory.com:specs:cor:acl:080:04`: the catalogue lists a memory only
 * when it is listed AND publicly accessible — a listing the visibility gate
 * hides is the silent nothing the issue is about).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Memory } from '$lib/types';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({
  beforeNavigate: () => {},
  goto: vi.fn(),
  invalidateAll: vi.fn(),
  replaceState: vi.fn(),
}));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/memories/mem-1/settings'),
      params: { id: 'mem-1' },
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

import Page from './+page.svelte';

const CARD_FORM = 'action="?/updateMarketplaceListing"';

async function renderCard(opts: {
  /** The PERSISTED memory — class, visibility, and the listing flag. */
  graphOverrides?: Partial<Memory>;
  /** The caller's actual org role; ADMIN is the positive manage fixture. */
  orgRole?: 'ADMIN' | 'CONTRIBUTOR';
  /** The layout's server-resolved manage access. Default true. */
  canManageMemory?: boolean;
  /** Omit the flag entirely — must read as NO grant, never as a grant. */
  omitCanManageMemory?: boolean;
}) {
  const graph = settingsGraph({ visibility: 'PUBLIC', ...opts.graphOverrides });

  const { form, vectorForm, marketplaceForm, schemaForm, deleteForm, retryEmbedsForm } = await settingsForms(graph);

  // The envelope cast follows `retry-embeds-gate.test.ts`: `PageData` is the
  // whole inherited layout chain, none of which this card touches beyond
  // `canManageMemory`, which IS set explicitly below.
  const html = render(Page, {
    props: {
      data: {
        graph,
        user: OWNER,
        ownerUserId: OWNER_ID,
        owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
        org: { id: 'org-1', members: [{ user: { id: OWNER_ID }, role: opts.orgRole ?? 'ADMIN' }] },
        allOrgs: [],
        transferCanDelete: false,
        canWriteMemory: true,
        ...(opts.omitCanManageMemory ? {} : { canManageMemory: opts.canManageMemory ?? true }),
        form,
        vectorForm,
        marketplaceForm,
        schemaForm,
        deleteForm,
        retryEmbedsForm,
      } as never,
      form: null as never,
    },
  }).body;
  return html;
}

/** The card's markup region — from its form action to the end of its form. */
function cardRegion(html: string): string {
  const start = html.indexOf(CARD_FORM);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('</form>', start));
}

describe('marketplace-listing card placement and gating (#841)', () => {
  it('renders for a knowledge memory with NO vector index — the card is not part of the vector section', async () => {
    // The first cut of this card nested it inside the
    // `{#if g.vectorIndexEnabled && canRetryEmbeds}` block, so a memory
    // without a vector index — most of them — never saw the control at all:
    // the same silent nothing the issue is about, one gate further in.
    const html = await renderCard({ graphOverrides: { vectorIndexEnabled: false } });
    expect(html).toContain(CARD_FORM);
  });

  it('withholds the card from an org contributor even when canManage is true', async () => {
    const html = await renderCard({ orgRole: 'CONTRIBUTOR', canManageMemory: true });
    expect(html).not.toContain(CARD_FORM);
  });

  it('withholds the card from a personal-class memory', async () => {
    const html = await renderCard({ graphOverrides: { class: 'personal', organizationId: null, visibility: null } });
    expect(html).not.toContain(CARD_FORM);
  });
});

describe('marketplace-listing visibility interplay (#841 / hrn:node:hadronmemory.com:specs:cor:acl:080:04)', () => {
  it('tells the editor to set visibility first, and disables the toggle, on a non-public memory', async () => {
    const html = await renderCard({ graphOverrides: { visibility: 'ORGANIZATION' } });
    const card = cardRegion(html);
    // "and save it": the gate reads the PERSISTED visibility, so choosing
    // Public is not enough until the Visibility form is saved (Charles's UX
    // P3 on #1244).
    expect(card).toContain('Only public memories can be listed. Set Visibility to Public and save it first.');
    expect(card).toContain('aria-describedby="marketplace-visibility-note"');
    expect(card).toContain('disabled=""');
    // The note is the sole explanation of the disabled state, so it must
    // clear the 4.5:1 text floor in dark mode too (Charles's UX P2 on
    // #1244): zinc-500 alone on dark:bg-zinc-900 is 3.67:1.
    expect(card).toContain('text-zinc-500 dark:text-zinc-400');
  });

  it('offers the unlist escape on a listed-but-not-public memory — the toggle stays enabled', async () => {
    const html = await renderCard({ graphOverrides: { visibility: 'ORGANIZATION', listedOnMarketplace: true } });
    const card = cardRegion(html);
    expect(card).toContain('This memory is listed but not public, so the catalogue hides it.');
    expect(card).not.toContain('disabled=""');
  });

  it('carries the persisted flag into the checkbox and drops the note on a public listed memory', async () => {
    const html = await renderCard({ graphOverrides: { listedOnMarketplace: true } });
    const card = cardRegion(html);
    expect(card).toContain('checked');
    expect(card).not.toContain('marketplace-visibility-note');
    expect(card).not.toContain('disabled=""');
  });

  it('offers an ENABLED, unchecked control on a public unlisted memory — listing is opt-in, never automatic', async () => {
    const html = await renderCard({ graphOverrides: { listedOnMarketplace: false } });
    const card = cardRegion(html);
    expect(card).not.toContain('checked');
    expect(card).not.toContain('disabled=""');
    expect(card).not.toContain('marketplace-visibility-note');
  });

  it('keeps the card for a known org ADMIN when the canManage audit is absent', async () => {
    const html = await renderCard({ omitCanManageMemory: true });
    expect(html).toContain(CARD_FORM);
  });
});
