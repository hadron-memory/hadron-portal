import { expect, it } from 'vitest';
import { definitionEntryHref, definitionHref } from './agent-inheritance';
it('encodes a scoped loc without changing its address', () => {
  expect(definitionHref('child', 'tasks:ship/preview')).toBe('/app/agents/child/definitions/tasks%3Aship%2Fpreview');
});
it('external listed nodes retain their canonical route', () => {
  expect(definitionEntryHref('child', { node: { id: 'task', memoryId: 'external', loc: 'tasks:ship', name: 'Ship', urn: 'hrn:node:example.com:external:tasks:ship', inheritedFrom: null }, trigger: null })).toBe('/app/memories/external/nodes/task');
});
