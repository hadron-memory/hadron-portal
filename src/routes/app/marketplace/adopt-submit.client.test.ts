/**
 * #685 / #840 — what each adopt card ACTUALLY submits, measured from a mounted
 * DOM rather than inferred from server-rendered markup.
 *
 * @copilot asked for this lane and was right to: the SSR tests can show that a
 * form exists carrying a given id, and cannot show what `new FormData(form)`
 * produces at submit time. That gap is where @codex's P1 lived — the previous
 * version chose the memory in an `onclick`, which `render` from `svelte/server`
 * never executes, so a card submitting an empty or stale `memoryId` left the
 * suite fully green.
 *
 * The fix removed the click-time write, so the failure mode is gone rather than
 * merely tested. These assertions are what would catch it coming back: they
 * serialize the SECOND card's form and check the id is that card's own, and
 * that the shared agent picker reaches every card's payload.
 *
 * Note this asserts on FormData, not on the markup. A test reading
 * `input.value` would pass against a component that renders the attribute and
 * never submits it.
 */
import { describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';

import Page from './+page.svelte';

const MEMORIES = [
  { id: 'm1', name: 'Kubernetes', urn: 'hrn:mem:acme.test:k8s', description: null },
  { id: 'm2', name: 'Postgres', urn: 'hrn:mem:acme.test:pg', description: null },
  { id: 'm3', name: 'Redis', urn: 'hrn:mem:acme.test:redis', description: null },
];
const AGENTS = [
  { id: 'a1', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe' },
  { id: 'a2', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe-2' },
];

function mountMarketplace(form: unknown = null) {
  return mountComponent(Page as never, {
    data: {
      organizations: { items: [], total: 0 },
      agents: { items: [], total: 0 },
      memories: { items: MEMORIES, total: MEMORIES.length },
      loadFailed: false,
      adoptTargets: AGENTS,
      adoptTargetsFailed: false,
    },
    form,
  } as never);
}

/** The adopt forms, in card order. */
function adoptForms(target: HTMLElement): HTMLFormElement[] {
  return Array.from(target.querySelectorAll<HTMLFormElement>('form[action="?/addToAgent"]'));
}

const payload = (f: HTMLFormElement) => Object.fromEntries(new FormData(f).entries());

describe('marketplace adopt submission (#685)', () => {
  it('serializes each card with its OWN memory id', () => {
    const { target, unmount } = mountMarketplace();
    try {
      const forms = adoptForms(target);
      expect(forms).toHaveLength(3);
      expect(forms.map((f) => payload(f).memoryId)).toEqual(['m1', 'm2', 'm3']);
      // The discriminator the action gates on has to travel too, or every
      // submission is refused before it reaches the mutation.
      expect(payload(forms[1])._kind).toBe('addToAgent');
    } finally {
      unmount();
    }
  });

  /**
   * This asserts the exact property the fix depends on, so it is worth being
   * precise about what it does and does not prove.
   *
   * Svelte 5 batches, so the hidden `agentId` inputs are NOT updated in the
   * same task as the `change` event — the first draft of this test read them
   * synchronously and failed, which is the same batching that produced
   * @codex's P1.
   *
   * The difference, and the whole reason this shape is safe where the P1 shape
   * was not: there, the write and the submit were one event dispatch (a click
   * handler and the submit it triggers), with no flush in between. Here they
   * are SEPARATE user interactions on separate elements, so at minimum a
   * microtask separates them.
   *
   * So the test awaits a microtask — deliberately NOT `flushSync()`. Forcing a
   * synchronous flush would prove only that the binding works when flushed,
   * which was never in doubt. Awaiting the weakest boundary a real second
   * interaction is guaranteed to clear is what shows the markup is actually
   * settled before any button can be pressed.
   */
  it('carries the chosen agent into every card by the time any button could be pressed', async () => {
    const { target, unmount } = mountMarketplace();
    try {
      // Nothing picked yet: the payload says so rather than defaulting to the
      // first agent, which would attach a memory to an agent nobody chose.
      expect(payload(adoptForms(target)[1]).agentId).toBe('');

      const select = target.querySelector<HTMLSelectElement>('#marketplaceAdoptAgent');
      expect(select).not.toBeNull();
      select!.value = 'a2';
      select!.dispatchEvent(new Event('change', { bubbles: true }));

      await Promise.resolve();

      expect(adoptForms(target).map((f) => payload(f).agentId)).toEqual(['a2', 'a2', 'a2']);
      // And the memory ids did not move with it.
      expect(adoptForms(target).map((f) => payload(f).memoryId)).toEqual(['m1', 'm2', 'm3']);
    } finally {
      unmount();
    }
  });

  it('keeps the agent choice after a submission, seeded from the returned form', () => {
    const { target, unmount } = mountMarketplace({
      form: {
        data: { _kind: 'addToAgent', memoryId: 'm2', agentId: 'a2' },
        message: { type: 'success', text: 'Added to your agent.' },
        errors: {},
        valid: true,
      },
    });
    try {
      // Without the seed the select resets on every full-page POST, so adding a
      // second memory means picking the agent again.
      const select = target.querySelector<HTMLSelectElement>('#marketplaceAdoptAgent');
      expect(select!.value).toBe('a2');
      expect(payload(adoptForms(target)[0]).agentId).toBe('a2');
    } finally {
      unmount();
    }
  });

  it('gives each button an accessible name naming its own memory', () => {
    const { target, unmount } = mountMarketplace();
    try {
      const labels = Array.from(target.querySelectorAll('button[type="submit"]')).map((b) =>
        b.getAttribute('aria-label'),
      );
      expect(labels).toEqual([
        'Add Kubernetes to agent',
        'Add Postgres to agent',
        'Add Redis to agent',
      ]);
      // The failing direction: identical names are exactly what @copilot
      // flagged, and a screen-reader user cannot tell those controls apart.
      expect(new Set(labels).size).toBe(labels.length);
    } finally {
      unmount();
    }
  });
});
