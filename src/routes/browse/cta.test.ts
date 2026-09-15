/**
 * #685 — the public catalogue's call to action.
 *
 * `/browse` is the signed-OUT front door: its loader builds a bare
 * `gqlClient()` with no token, so there is no session to attach a memory to
 * anyone with. The CTA here is a link INTO the product, not an adopt button.
 *
 * It points at the memory (`/app/u/<urn>`) rather than at /app/marketplace,
 * and that is the part worth pinning: this page lists every PUBLIC memory
 * while the marketplace lists the `listedOnMarketplace` subset, so a
 * marketplace link under a per-memory label promises a destination that
 * routinely does not contain that memory. Driving both pages locally is what
 * showed it — /browse had eleven memories and the marketplace had none.
 *
 * The assertions below also pin what the link must NOT be. Reviving a
 * `?memory=` / `?addMemory=` intent is the dead chain #686/#838 removed one
 * commit earlier, and #685's third bullet asks for exactly that — so this is
 * the guard against implementing the issue's letter over the decision that
 * superseded it.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import Page from './+page.svelte';

const MEMORY = {
  id: 'm1',
  name: 'Kubernetes',
  urn: 'hrn:mem:acme.test:k8s',
  source: null,
  lastSyncedAt: null,
};

const CTA = 'Open this memory';

function renderBrowse(opts: { memories?: unknown[]; loadFailed?: boolean } = {}) {
  return render(Page as never, {
    props: {
      data: {
        memories: opts.memories ?? [MEMORY],
        loadFailed: opts.loadFailed ?? false,
      },
    } as never,
  }).body;
}

describe('public browse CTA (#685)', () => {
  it('links each card at the memory it names, not at the marketplace', () => {
    const html = renderBrowse();
    expect(html).toContain(CTA);
    expect(html).toContain(`/app/u/${encodeURIComponent(MEMORY.urn)}`);
    // The failing direction of the same claim: a marketplace link would pass
    // the "has a CTA" half while breaking the promise the label makes, because
    // this list is a SUPERSET of the marketplace's.
    expect(html).not.toContain('/app/marketplace');
  });

  it('does NOT revive the retired ?memory= / ?addMemory= sign-up intent', () => {
    const html = renderBrowse();
    expect(html).not.toContain('addMemory=');
    expect(html).not.toContain('memory=m1');
    expect(html).not.toContain('/signup?memory');
  });

  // The CTA hangs off a card, so the two states that render no cards must
  // render no CTA either — otherwise an outage page offers a button for a
  // memory it could not read.
  it('renders no CTA when the catalogue could not be read', () => {
    const html = renderBrowse({ memories: [], loadFailed: true });
    expect(html).not.toContain(CTA);
    expect(html).toContain('not an empty catalogue');
  });

  it('renders no CTA when the catalogue is genuinely empty', () => {
    const html = renderBrowse({ memories: [] });
    expect(html).not.toContain(CTA);
    expect(html).toContain('No public memories yet.');
  });
});
