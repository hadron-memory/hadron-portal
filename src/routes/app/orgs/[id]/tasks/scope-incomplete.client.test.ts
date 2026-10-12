/** #1689 — the Task Nodes page names the cause: a failed system lookup is a warning, not a failed node query. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const row = {
  id: 't1', memoryId: 'mem-1', loc: 'tasks:t1', name: 'Task one', description: 'd',
  urn: 'hrn:node:acme.com:ops:tasks:t1', export: { kind: 'none' },
};

function mountPage(over: Record<string, unknown>) {
  setStubPage('https://example.test/app/orgs/org-1/tasks', { id: 'org-1' });
  const m = mountComponent(Page as never, {
    data: { org: { id: 'org-1', name: 'Acme' }, tasks: [row], failed: false, truncated: false, scopeIncomplete: false, ...over },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}
const q = (t: HTMLElement, id: string) => t.querySelector(`[data-testid="${id}"]`);

describe('Task Nodes page — incomplete scope (#1689)', () => {
  it('warns while still listing the tasks it reached, without the node-query error', () => {
    const t = mountPage({ scopeIncomplete: true });
    expect(q(t, 'tasks-scope-incomplete')).not.toBeNull();
    expect(t.textContent).toContain('Task one');
    expect(t.textContent).not.toContain('the node query failed');
  });

  it('a failed node query keeps its own message', () => {
    const t = mountPage({ failed: true, tasks: [] });
    expect(t.textContent).toContain('the node query failed');
    expect(q(t, 'tasks-scope-incomplete')).toBeNull();
  });

  it('shows no warning when the scope was complete', () => {
    expect(q(mountPage({}), 'tasks-scope-incomplete')).toBeNull();
  });
});
