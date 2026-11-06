/**
 * portal#1656: the New-node default loc is suffixed against the siblings the
 * loader read with `childrenOf`, and says when that read was not the whole list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { createNodeSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountPage(existingLocs: string[], siblingsPartial: boolean) {
  const form = await superValidate({}, zod4(createNodeSchema), { errors: false });
  const m = mountComponent(Page as never, {
    data: {
      graph: { id: 'm1', name: 'Test memory', urn: 'hrn:mem:acme:docs', schema: null },
      org: null, parentLoc: 'p', existingLocs, siblingsPartial, prefillLoc: '', form,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('New node: siblings for the default loc (portal#1656)', () => {
  it('suggests p:a-3 under siblings a and a-2, with no may-collide note', async () => {
    const t = await mountPage(['p:a', 'p:a-2'], false);
    type(t.querySelector<HTMLInputElement>('#name')!, 'A');
    expect(t.querySelector<HTMLInputElement>('#loc')!.value).toBe('p:a-3');
    expect(t.querySelector('[data-testid="loc-may-collide"]')).toBeNull();
  });

  it('a partial sibling list says the suggestion may collide, and links it to the field', async () => {
    const t = await mountPage(['p:a'], true);
    expect(t.querySelector('[data-testid="loc-may-collide"]')).toBeNull(); // nothing suggested yet
    type(t.querySelector<HTMLInputElement>('#name')!, 'A');
    const note = t.querySelector('[data-testid="loc-may-collide"]');
    expect(note?.textContent).toMatch(/may already exist/);
    expect(t.querySelector('#loc')!.getAttribute('aria-describedby')).toContain('locMayCollide');
  });

  it('the note goes once the user types their own loc', async () => {
    const t = await mountPage(['p:a'], true);
    type(t.querySelector<HTMLInputElement>('#name')!, 'A');
    type(t.querySelector<HTMLInputElement>('#loc')!, 'p:mine');
    expect(t.querySelector('[data-testid="loc-may-collide"]')).toBeNull();
  });
});
