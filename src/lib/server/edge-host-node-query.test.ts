import { describe, it, expect } from 'vitest';
import { EDGE_HOST_NODE_QUERY } from './queries';

// Regression guard: the edge detail page loads its edge via nodeById's
// `outgoingEdges`. The server resolver only Prisma-includes `target` for
// outgoing edges (no Edge.source field resolver), so selecting `source { … }`
// here resolves to null against the non-null `Edge.source: Node!` schema field
// and errors the WHOLE query → loader throws → 500 on every edge detail page.
// See findings:edge-query-nonnull-endpoint-500. The host node IS the source,
// so the page renders it from `host` and never needs `edge.source`.
describe('EDGE_HOST_NODE_QUERY', () => {
  function outgoingEdgesBlock(): string {
    const start = EDGE_HOST_NODE_QUERY.indexOf('outgoingEdges');
    expect(start).toBeGreaterThan(-1);
    return EDGE_HOST_NODE_QUERY.slice(start);
  }

  it('selects the target endpoint (the "other" node)', () => {
    expect(outgoingEdgesBlock()).toContain('target {');
  });

  it('does NOT select the source endpoint on outgoing edges (would 500)', () => {
    // nodeById only includes `target` for outgoingEdges; selecting `source`
    // hits a non-null-field null and errors the entire query.
    expect(outgoingEdgesBlock()).not.toContain('source {');
  });
});
