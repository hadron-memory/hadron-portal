import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import NodeList from './NodeList.svelte';
import { NODE_FIELDS } from '$lib/server/queries';

// Regression for the node-listing badge showing loc-only (e.g. `preflight`)
// instead of the full node URN (`micromentor.org::mmdata::preflight`). Two
// halves had to be right: the query had to fetch the node's memory urn, and
// the list had to compose it with the loc.

const node = {
  id: 'n1',
  memoryId: 'm1',
  memory: { id: 'm1', urn: 'micromentor.org::mmdata', name: 'mmdata' },
  nodeType: 'info',
  loc: 'preflight',
  name: 'Preflight',
  description: null,
  tags: [],
} as never;

describe('node listing renders the full node URN, not loc-only', () => {
  // Data-layer guard: the root cause was NODE_FIELDS omitting `memory`, so
  // node.memory?.urn was always undefined and nodeUrn() degraded to the loc.
  it('NODE_FIELDS fetches the node memory urn', () => {
    expect(NODE_FIELDS).toMatch(/memory\s*\{[^}]*\burn\b/);
  });

  // Render-layer guard: with the memory urn supplied via the prop (the
  // single-memory MemoryBrowser path), the badge composes the full URN.
  it('composes the full URN from the memoryUrn prop + loc', () => {
    const { body } = render(NodeList, {
      props: { nodes: [node], memoryUrn: 'micromentor.org::mmdata' },
    });
    expect(body).toContain('micromentor.org::mmdata::preflight');
  });

  // Render-layer guard: with no memoryUrn prop (the multi-memory agent/app
  // path), it falls back to each node's own memory.urn.
  it('falls back to node.memory.urn when no memoryUrn prop is given', () => {
    const { body } = render(NodeList, { props: { nodes: [node] } });
    expect(body).toContain('micromentor.org::mmdata::preflight');
  });
});
