import { afterEach, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });
it('shows a linked base and both read-only lists on the canonical Agent page', async () => {
  const data = { ...await pageData('child', null), inheritance: {
    base: { id: 'base', agent: { id: 'base', name: 'Engineer', urn: 'hrn:agent:example.com:engineer' }, error: null },
    tasks: { items: [], error: null }, processes: { items: null, error: 'Process list refused' },
  } };
  mounted = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  const root = mounted.target;
  expect(root.querySelector('a[href="/app/agents/base"]')?.textContent).toBe('Engineer');
  const tab = (label: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
  tab('Tasks').click(); flushSync(); await tick();
  expect(root.textContent).toContain('No tasks listed.');
  tab('Processes').click(); flushSync(); await tick();
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('Process list refused');
});
