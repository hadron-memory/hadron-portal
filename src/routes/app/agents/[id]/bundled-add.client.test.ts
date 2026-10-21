/**
 * #1173: the Bundled agents tab can add an agent. Mounted, not rendered: the
 * tab is chosen by a click and the result lands through the `form` prop.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const helper = { id: 'ag-helper', name: 'Helper', urn: 'hrn:agent:acme.com:helper' };

async function open(extra: Record<string, unknown>, form: unknown = null) {
  const data = { ...(await pageData('a', { mentionOnly: false })), ...extra };
  const m = mountComponent(Page as never, { data, form } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  const tab = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Bundled agents');
  return { root: m.target, tab: tab as HTMLButtonElement | undefined };
}

describe('Bundled agents tab — add (#1173)', () => {
  it('an agent that bundles nothing still gets the tab when there is something to add, with the add form', async () => {
    const { root, tab } = await open({ bundledAgents: [], bundleCandidates: [helper], nextImportPosition: 3 });
    expect(tab).toBeDefined();
    tab!.click();
    await tick();
    const form = root.querySelector('form[action="?/addBundledAgent"]') as HTMLFormElement;
    expect(form).not.toBeNull();
    expect((form.querySelector('input[name="position"]') as HTMLInputElement).value).toBe('3');
    const select = form.querySelector('select[name="agentId"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'ag-helper']);
    expect(select.options[1].textContent).toContain('hrn:agent:acme.com:helper');
    expect((form.querySelector('input[name="required"]') as HTMLInputElement).checked).toBe(true);
    expect(form.querySelector('label[for="bundleAgentId"]')).not.toBeNull();
  });

  it('no candidates and nothing bundled: no tab, as before', async () => {
    const { tab } = await open({ bundledAgents: [], bundleCandidates: [] });
    expect(tab).toBeUndefined();
  });

  it('an org agent with nothing licensed to bundle says so instead of showing an empty control', async () => {
    const { root, tab } = await open({
      org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com', members: [], memories: [], agents: [], apps: [] },
      bundledAgents: [{ id: 'x', name: 'X', urn: 'hrn:agent:acme.com:x', description: null, personaRole: null, via: 'Import' }],
      bundleCandidates: [],
    });
    tab!.click();
    await tick();
    expect(root.querySelector('form[action="?/addBundledAgent"]')).toBeNull();
    expect(root.textContent).toContain('active license');
  });

  it('nothing to add but something bundled: the tab shows, with no add form', async () => {
    const { root, tab } = await open({
      bundledAgents: [{ id: 'x', name: 'X', urn: 'hrn:agent:acme.com:x', description: null, personaRole: null, via: 'Import' }],
      bundleCandidates: [],
    });
    tab!.click();
    await tick();
    expect(root.querySelector('form[action="?/addBundledAgent"]')).toBeNull();
  });

  it('shows the server’s refusal as an alert and the success line as a status', async () => {
    const refused = await open({ bundleCandidates: [helper] }, { bundleError: 'Imports are one level deep.' });
    refused.tab!.click();
    await tick();
    expect(refused.root.querySelector('[role="alert"]')?.textContent).toContain('one level deep');

    const added = await open({ bundleCandidates: [helper] }, { bundleAdded: true });
    added.tab!.click();
    await tick();
    expect(added.root.querySelector('[role="status"]')?.textContent).toContain('Agent bundled');
  });

  // portal#1189 SECOND READ (Gizelle, P2): with nothing bundled yet, a failed
  // candidates read hid the whole tab, so the failure was invisible.
  it('a candidates load failure on an agent that bundles nothing still shows the tab and says so', async () => {
    const { root, tab } = await open({ bundledAgents: [], bundleCandidates: [], bundleCandidatesError: true });
    expect(tab).toBeDefined();
    tab!.click();
    await tick();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(root.querySelector('form[action="?/addBundledAgent"]')).toBeNull();
  });

  it('a candidates load failure says so instead of silently hiding the control', async () => {
    const { root, tab } = await open({
      bundledAgents: [{ id: 'x', name: 'X', urn: 'hrn:agent:acme.com:x', description: null, personaRole: null, via: 'Import' }],
      bundleCandidates: [],
      bundleCandidatesError: true,
    });
    tab!.click();
    await tick();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(root.querySelector('form[action="?/addBundledAgent"]')).toBeNull();
  });
});
