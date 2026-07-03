import { describe, it, expect } from 'vitest';
import { EDGE_HOST_NODE_QUERY } from './queries';

// Regression guard: the edge detail page loads its edge via node(ref:)'s
// `outgoingEdges`. The server resolver only Prisma-includes `target` for
// outgoing edges (no Edge.source field resolver), so selecting `source { … }`
// here resolves to null against the non-null `Edge.source: Node!` schema field
// and errors the WHOLE query → loader throws → 500 on every edge detail page.
// See findings:edge-query-nonnull-endpoint-500. The host node IS the source,
// so the page renders it from `host` and never needs `edge.source`.
describe('EDGE_HOST_NODE_QUERY', () => {
  // Extract exactly the `outgoingEdges { … }` selection set via brace
  // counting, so the assertions only see that block — a `source { … }`
  // elsewhere in the query (e.g. a future incomingEdges selection) can't
  // produce a false negative here.
  function outgoingEdgesBlock(): string {
    const field = EDGE_HOST_NODE_QUERY.indexOf('outgoingEdges');
    expect(field).toBeGreaterThan(-1);
    const open = EDGE_HOST_NODE_QUERY.indexOf('{', field);
    expect(open).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = open; i < EDGE_HOST_NODE_QUERY.length; i++) {
      const ch = EDGE_HOST_NODE_QUERY[i];
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        return EDGE_HOST_NODE_QUERY.slice(open, i + 1);
      }
    }
    throw new Error('unbalanced braces in outgoingEdges selection');
  }

  // Tolerate any whitespace between the field name and its selection set
  // (`source {`, `source{`, `source\n{`).
  const SOURCE_SELECTION = /\bsource\s*\{/;
  const TARGET_SELECTION = /\btarget\s*\{/;

  it('selects the target endpoint (the "other" node)', () => {
    expect(outgoingEdgesBlock()).toMatch(TARGET_SELECTION);
  });

  it('does NOT select the source endpoint on outgoing edges (would 500)', () => {
    // The node read only includes `target` for outgoingEdges; selecting `source`
    // hits a non-null-field null and errors the entire query.
    expect(outgoingEdgesBlock()).not.toMatch(SOURCE_SELECTION);
  });
});
