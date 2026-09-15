/**
 * #685 — what the marketplace renders in each adopt state.
 *
 * Three states, and two of them produce an EMPTY picker, which is the pair a
 * careless test collapses:
 *
 *   adoptTargets: [] , failed: false → you own no agents      (offer to create one)
 *   adoptTargets: [] , failed: true  → we could not ask       (say so, offer nothing)
 *   adoptTargets: [a], failed: false → the picker + per-card buttons
 *
 * Each is asserted against the OTHERS' copy as well as its own. A test that
 * only checks its own string passes when two states render identically — which
 * is the shape of the #839 defect where "nobody has access" was rendered at an
 * unauthorized caller.
 *
 * The button gate is pinned in BOTH directions on purpose
 * (`hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail`): asserting the button appears when
 * there are agents says nothing unless the same markup is shown to NOT appear
 * when there are none. An always-rendered button passes the first half.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { addMarketplaceMemoryToAgentSchema } from './schema';
import type { MarketplaceRef } from './+page.server';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/marketplace'),
      params: {},
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

import Page from './+page.svelte';

const PICKER = 'marketplaceAdoptAgent';
const ADD_BUTTON = 'Add to agent';
const NO_AGENTS = 'You have no agents of your own yet';
const TARGETS_FAILED = "Couldn't load your agents just now";
const RESTORED_COPY = 'instant expertise';

const MEMORY: MarketplaceRef = { id: 'm1', name: 'Kubernetes', urn: 'hrn:mem:acme.test:k8s', description: 'Cluster lore' };
const AGENT = { id: 'a1', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe' };

function renderMarketplace(opts: {
  adoptTargets?: Array<{ id: string; name: string; urn: string }>;
  adoptTargetsFailed?: boolean;
  memories?: MarketplaceRef[];
  loadFailed?: boolean;
  form?: unknown;
} = {}) {
  const memories = opts.memories ?? [MEMORY];
  return render(Page as never, {
    props: {
      data: {
        organizations: { items: [], total: 0 },
        agents: { items: [], total: 0 },
        memories: { items: memories, total: memories.length },
        loadFailed: opts.loadFailed ?? false,
        adoptTargets: opts.adoptTargets ?? [],
        adoptTargetsFailed: opts.adoptTargetsFailed ?? false,
      },
      form: opts.form ?? null,
    } as never,
  }).body;
}

describe('marketplace adopt CTA (#685)', () => {
  it('renders the agent picker and a per-memory button when the caller owns an agent', async () => {
    const html = renderMarketplace({ adoptTargets: [AGENT] });
    expect(html).toContain(PICKER);
    expect(html).toContain(ADD_BUTTON);
    expect(html).toContain('?/addToAgent');
    expect(html).toContain('Scribe');
    // Not either of the other two states.
    expect(html).not.toContain(NO_AGENTS);
    expect(html).not.toContain(TARGETS_FAILED);
  });

  it('offers no add button at all when the caller owns no agents', async () => {
    const html = renderMarketplace({ adoptTargets: [] });
    expect(html).toContain(NO_AGENTS);
    // The gate, in the failing direction. An always-rendered button passes the
    // test above and fails here.
    expect(html).not.toContain(PICKER);
    expect(html).not.toContain(ADD_BUTTON);
    expect(html).not.toContain(TARGETS_FAILED);
  });

  it('an agents-query failure says so, and does NOT claim the caller has none', async () => {
    const html = renderMarketplace({ adoptTargets: [], adoptTargetsFailed: true });
    expect(html).toContain(TARGETS_FAILED);
    // The distinction this state exists for: "you have no agents" is a claim
    // about the account, and the query that would establish it threw.
    expect(html).not.toContain(NO_AGENTS);
    expect(html).not.toContain(PICKER);
    expect(html).not.toContain(ADD_BUTTON);
  });

  /**
   * @codex P1 on #840, and the reason the enhanced single-form version was
   * replaced: a per-card button that wrote `memory.id` into a Superforms store
   * on click submitted the PREVIOUS card's id, because the click and the submit
   * it triggers run in the same task and Svelte has not flushed the store into
   * the bound input yet.
   *
   * SSR cannot click, so nothing in this file catches that directly. What it
   * CAN pin is the structural property that makes the bug impossible: each card
   * owns a form carrying its own `memoryId` as a literal, so there is nothing
   * to flush. A regression to one shared form fails these.
   */
  it('gives each memory its own form carrying its own id', () => {
    const html = renderMarketplace({
      adoptTargets: [AGENT],
      memories: [MEMORY, { id: 'm2', name: 'Postgres', urn: 'hrn:mem:acme.test:pg', description: null }],
    });
    expect(html.match(/action="\?\/addToAgent"/g) ?? []).toHaveLength(2);
    expect(html).toContain('value="m1"');
    expect(html).toContain('value="m2"');
  });

  it('never renders an empty memory id waiting to be filled in by a click', () => {
    const html = renderMarketplace({ adoptTargets: [AGENT] });
    // The broken version rendered ONE form for the grid and one hidden
    // memoryId, empty until a click wrote into it. That empty value is the
    // symptom, so it is what this asserts against.
    expect(html).not.toContain('name="memoryId" value=""');
  });

  // @codex P2: two of the caller's agents may share a display name, and then
  // identical-looking options submit different ids.
  it('identifies each agent option by its URN, not by name alone', () => {
    const html = renderMarketplace({
      adoptTargets: [AGENT, { id: 'a2', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe-2' }],
    });
    expect(html).toContain('hrn:agent:acme.test:scribe-2');
    expect(html.match(/Scribe/g) ?? []).toHaveLength(2);
  });

  it('restores the copy the CTA was removed with', () => {
    const html = renderMarketplace({ adoptTargets: [AGENT] });
    expect(html).toContain(RESTORED_COPY);
  });

  it('renders no adopt form when the catalogue has no memories', async () => {
    const html = renderMarketplace({ adoptTargets: [AGENT], memories: [] });
    expect(html).not.toContain('?/addToAgent');
    expect(html).not.toContain(ADD_BUTTON);
  });
});

describe('marketplace adopt feedback is scoped to the card that produced it (#685)', () => {
  /**
   * An ActionData shaped like the one `message(form, …)` returns — built by
   * the real `superValidate` rather than by hand.
   *
   * A hand-written `{ data, message, errors, valid }` literal looks equivalent
   * and is not: `superForm` reads fields this fixture would omit, and the page
   * feeds the submitted form straight back into it. The literal threw at
   * render, so the object under test has to be the genuine one.
   */
  const actionData = async (memoryId: string, message: { type: string; text: string }) => ({
    form: {
      ...(await superValidate(
        { _kind: 'addToAgent' as const, memoryId, agentId: 'a1' },
        zod4(addMarketplaceMemoryToAgentSchema),
        { errors: false },
      )),
      message,
    },
  });

  const TWO: MarketplaceRef[] = [MEMORY, { id: 'm2', name: 'Postgres', urn: 'hrn:mem:acme.test:pg', description: null }];

  it('renders the success beside the memory it was submitted for', async () => {
    const html = renderMarketplace({
      adoptTargets: [AGENT],
      memories: TWO,
      form: await actionData('m2', { type: 'success', text: 'Added to your agent.' }),
    });
    expect(html).toContain('Added to your agent.');
    // One banner, not one per card — the scoping is the whole point.
    expect(html.match(/Added to your agent\./g) ?? []).toHaveLength(1);
  });

  it('renders a refusal beside the memory it was submitted for', async () => {
    const html = renderMarketplace({
      adoptTargets: [AGENT],
      memories: TWO,
      form: await actionData('m1', { type: 'error', text: 'Nope.' }),
    });
    expect(html).toContain('Nope.');
    expect(html.match(/Nope\./g) ?? []).toHaveLength(1);
  });

  it('shows nothing when the last action was a different form', async () => {
    const html = renderMarketplace({
      adoptTargets: [AGENT],
      memories: TWO,
      form: {
        form: {
          ...(await superValidate(
            { _kind: 'addToAgent' as const, memoryId: 'm1', agentId: 'a1' },
            zod4(addMarketplaceMemoryToAgentSchema),
            { errors: false },
          )),
          // A DIFFERENT form's discriminator — `submittedForm` must not match it.
          data: { _kind: 'addMemory', memoryId: 'm1', role: 'read' },
          message: { type: 'success', text: 'Memory added.' },
        },
      },
    });
    expect(html).not.toContain('Memory added.');
  });
});
