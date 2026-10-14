import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
it('identifies the base while keeping the node own URN and safely displaying content', () => {
  const { body } = render(Page, { props: { data: {
    agent: { id: 'child', name: 'Child', urn: 'hrn:agent:example.com:child', systemMemoryId: 'child-memory' },
    node: { id: 'node', name: 'Ship', loc: 'tasks:ship', urn: 'hrn:node:example.com:base:tasks:ship', content: '<script>danger()</script>', inheritedFrom: { agentId: 'base', agentUrn: 'hrn:agent:example.com:base' } },
  } as never } });
  expect(body).toContain('Inherited from');
  expect(body).toContain('/app/agents/base');
  expect(body).toContain('hrn:node:example.com:base:tasks:ship');
  expect(body).not.toContain('<script>danger()');
  expect(body).toContain('&lt;script>danger()&lt;/script>');
});
