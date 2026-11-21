/** portal#2376 — the Runs panel's Flows-failed note is a persistent LiveRegion (before / during / after). */
import { afterEach, beforeEach, describe, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { pinRegion } from '$lib/test/pinStatusRegion';
import { runAppFlowSchema } from './schema';
import Panel from './AppRunsPanel.svelte';

beforeEach(() => setStubPage('http://localhost/app/apps/app-1?tab=runs', { appId: 'app-1' }));
const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const flow = { entry: { id: 'n1', memoryId: 'm1', loc: 'flows:one', name: 'Flow One', urn: 'hrn:node:acme.com:flows:flows:one' }, branchCount: 1, stepCount: 1 };

describe('Runs panel notes', () => {
  it('Flows could not be read', async () => {
    const props = reactiveProps<Record<string, unknown>>({
      data: {
        app: { id: 'app-1', name: 'Digest', organizationId: 'org-1' },
        runs: [], total: 0, page: 1, pageSize: 20, status: null, statuses: [], sort: 'createdAt', dir: 'desc', failed: false,
        flows: [flow], flowsPage: { offset: 0, count: 1, total: 1, firstHref: null, previousHref: null, nextHref: null }, flowsError: false,
        runForm: await superValidate(zod4(runAppFlowSchema), { errors: false }), runAgents: null,
      },
      form: null,
    });
    const m = mountComponent(Panel as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const data = props.data as Record<string, unknown>;
    await pinRegion({ root: m.target, text: 'Flows couldn’t load', settle: () => tick(2),
      raise: () => { props.data = { ...data, flowsError: true }; }, clear: () => { props.data = { ...data, flowsError: false }; } });
  });
});
