/**
 * portal#1444 — the choice reaches the form a Run button submits. SSR cannot
 * see this: the hidden agentRef follows the picker's store only once mounted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { runAppFlowSchema } from './schema';
import Page from './+page.svelte';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const flow = {
  entry: { id: 'n1', memoryId: 'm1', loc: 'flows:one', name: 'Flow One', urn: 'hrn:node:acme.com:flows:flows:one' },
  branchCount: 1,
  stepCount: 1,
};
const agents = [
  { id: 'ag-1', name: 'Writer', urn: 'hrn:agent:x:writer' },
  { id: 'ag-2', name: 'Editor', urn: 'hrn:agent:x:editor' },
];

async function mountRuns(runAgents: unknown) {
  const runForm = await superValidate(zod4(runAppFlowSchema), { errors: false });
  const m = mountComponent(Page as never, {
    data: {
      app: { id: 'app-1', name: 'Digest', organizationId: 'org-1' },
      runs: [], total: 0, page: 1, pageSize: 25, status: null,
      flows: [flow], flowsCapped: false, flowsScanned: 1, runForm, runAgents,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}

const hidden = (t: HTMLElement) =>
  t.querySelector<HTMLInputElement>('form[action="?/run"] input[name="agentRef"]');

describe('runs page: Agent picker (#1444)', () => {
  it('choosing an Agent puts it in the Run form; unchosen, the form carries an empty agentRef', async () => {
    const t = await mountRuns(agents);
    expect(hidden(t)!.value).toBe('');
    const select = t.querySelector<HTMLSelectElement>('#runAgent')!;
    select.value = 'ag-2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(hidden(t)!.value).toBe('ag-2');
  });

  it('no picker without several Agents', async () => {
    const t = await mountRuns(null);
    expect(t.querySelector('#runAgent')).toBeNull();
  });
});
