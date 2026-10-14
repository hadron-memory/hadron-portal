import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import AgentDefinitions from './AgentDefinitions.svelte';
import type { DefinitionEntry } from '$lib/agent-inheritance';
const mounts: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounts.length) mounts.pop()!.unmount(); });
const entry = (name: string, inherited = false): DefinitionEntry => ({ node: { id: name, memoryId: 'memory', loc: 'tasks:ship', name, urn: `hrn:node:example.com:base:${name}`, inheritedFrom: inherited ? { agentId: 'base', agentUrn: 'hrn:agent:example.com:base' } : null }, trigger: 'when ready', kind: 'INVOLVED' });
async function mount(props: Record<string, unknown>) {
  const m = mountComponent(AgentDefinitions as never, props as never) as Mounted<Record<string, unknown>>;
  mounts.push(m); await tick(); return m.target;
}
describe('Agent definition grids', () => {
  it('renders server order, own URNs, child-context links, triggers and relationships', async () => {
    const root = await mount({ agentId: 'child', read: { items: [entry('zeta', true), entry('alpha')], error: null }, processes: true });
    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('zeta');
    expect(rows[0].textContent).toContain('when ready');
    expect(rows[0].textContent).toContain('Involved');
    expect(rows[0].textContent).toContain('Inherited from');
    expect(rows[0].querySelector('[title="hrn:node:example.com:base:zeta"]')).not.toBeNull();
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/app/agents/child/definitions/tasks%3Aship');
    expect(rows[1].querySelector('a')?.getAttribute('href')).toBe('/app/memories/memory/nodes/alpha');
  });
  it('updates when navigation reuses it, and never presents a refusal as an empty list', async () => {
    const props = reactiveProps({ agentId: 'child', read: { items: [entry('old')], error: null } } as Record<string, unknown>);
    const root = await mount(props);
    props.read = { items: null, error: 'Permission refused by server' }; flushSync(); await tick();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Permission refused by server');
    expect(root.textContent).not.toContain('old');
    expect(root.textContent).not.toContain('No tasks');
    props.read = { items: [], error: null }; flushSync(); await tick();
    expect(root.textContent).toContain('No tasks listed.');
  });
});
