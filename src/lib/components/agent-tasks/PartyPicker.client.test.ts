/** portal#1148 (hadron-server#2089): a withheld member roster is said, not silently offered as no People. */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import PartyPicker from './PartyPicker.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mount(over: Record<string, unknown>) {
  const m = mountComponent(PartyPicker as never, {
    name: 'assignee', id: 'a', label: 'Assignee', value: '', other: '',
    workers: [{ id: 'w1', name: 'Ada', role: null, urn: null }], people: [], ...over,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('PartyPicker: withheld people', () => {
  it('says the members are not visible, and still offers Someone else', async () => {
    const t = await mount({ peopleWithheld: true });
    expect(t.textContent).toContain('This App’s members aren’t visible to you');
    expect(t.querySelector('option[value="other"]')).not.toBeNull();
  });
  it('known-empty control: no People and not withheld says nothing', async () => {
    const t = await mount({ peopleWithheld: false });
    expect(t.textContent).not.toContain('aren’t visible to you');
  });
});
