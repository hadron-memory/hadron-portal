/**
 * portal#2376 (slice 3 of #2344): the Task Nodes page's incomplete-scope warning is in a region that is
 * mounted before it speaks. Before/during/after: the region EXISTS and is EMPTY while the scope was
 * complete, holds the warning, and is the SAME element when the scope is complete again.
 */
import { afterEach, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { expectRegionLifecycle } from '$lib/test/statusRegionLifecycle';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

it('"The organization’s system memories could not be listed": empty, then text, then the same element', async () => {
  setStubPage('https://example.test/app/orgs/org-1/tasks', { id: 'org-1' });
  const data = { org: { id: 'org-1', name: 'Acme' }, tasks: [], failed: false, truncated: false, scopeIncomplete: false };
  const props = reactiveProps<Record<string, unknown>>({ data });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  const scope = (scopeIncomplete: boolean) => () => { props.data = { ...data, scopeIncomplete }; };
  await expectRegionLifecycle(mounted.target, 'system memories could not be listed', scope(true), scope(false), () => tick());
});
