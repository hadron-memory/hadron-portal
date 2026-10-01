/**
 * hadron-server#1526 (#1522): `AgentImport.importedAgent` is null when the
 * viewer may not read that Agent. The Profile tab's Imports list must still
 * render the import, unlinked, rather than throw on `.name`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const readable = {
  parentAgentId: 'a', importedAgentId: 'ag-ok', position: 1, required: true,
  importedAgent: { id: 'ag-ok', urn: 'hrn:agent:ada:helper', name: 'Helper', description: null, personaRole: null },
};
const hidden = { parentAgentId: 'a', importedAgentId: 'ag-hidden', position: 2, required: false, importedAgent: null };

describe('agent Profile — Imports with an unreadable imported Agent', () => {
  it('renders the readable import as a link and the unreadable one as a plain, unlinked row', async () => {
    const m = mountComponent(Page as never, {
      data: await pageData('a', { mentionOnly: false }, { imports: [readable, hidden] }),
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick();
    const root = m.target;
    expect(root.querySelector('a[href="/app/agents/ag-ok"]')?.textContent).toBe('Helper');
    expect(root.textContent).toContain('An agent you can’t view');
    expect(root.querySelector('a[href="/app/agents/ag-hidden"]')).toBeNull();
    expect(root.textContent).toContain('optional'); // the hidden import's row is still there
  });
});
