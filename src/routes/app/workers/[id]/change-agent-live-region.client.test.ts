import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, idleStatusAtMount, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, firstPopulatedStatusText } from '$lib/test/firstPopulatedStatusText';
import ChangeWorkerAgent from './ChangeWorkerAgent.svelte';

// portal#2375 (part B of #2344): the "Agent changed" result lives in a region that exists, empty,
// BEFORE the action, holds the text during, and is the SAME element after. Without LiveRegion the
// status element is inserted already populated, so it is not in the at-mount idle list (red on main).
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const options = [{ id: 'a-2', name: 'Reviewer', urn: 'hrn:agent:x:reviewer' }];

describe('ChangeWorkerAgent result is announced from a persistent region', () => {
  it('exists and is empty before, holds the text during, and is the same element after', async () => {
    const p = reactiveProps<Record<string, unknown>>({ options, result: null });
    mounted = mountComponent(ChangeWorkerAgent as never, p as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const root = mounted.target;
    const idle = idleStatusAtMount(root);
    expect(idle.length, 'a status region exists, empty, at mount').toBeGreaterThan(0);
    expect(firstPopulatedStatusText(root)).toBeNull();

    p.result = { ok: true, agentName: 'Reviewer' };
    flushSync(); await tick();
    const during = announcedStatusRegion(root)!;
    expect(during.textContent).toContain('Agent changed to Reviewer');
    expect(idle, 'the announcing region is one that already existed').toContain(during);

    p.result = null;
    flushSync(); await tick();
    expect(idle[idle.indexOf(during)]).toBe(during);
    expect(during.isConnected).toBe(true);
    expect(during.textContent?.trim()).toBe('');
  });

  it('a refusal is an alert, not the status region', async () => {
    const p = reactiveProps<Record<string, unknown>>({ options, result: null });
    mounted = mountComponent(ChangeWorkerAgent as never, p as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    p.result = { ok: false, refusal: { message: 'Not allowed.' } };
    flushSync(); await tick();
    expect(mounted.target.querySelector('[role="alert"]')?.textContent).toContain('Not allowed.');
    expect(firstPopulatedStatusText(mounted.target)).toBeNull();
  });
});
