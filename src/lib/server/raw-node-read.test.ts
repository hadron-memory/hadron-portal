/**
 * Regression for #485 — mustache vars destroyed by the editor round-trip.
 *
 * node(ref:) compiles Mustache templates on read unless raw: true
 * (hadron-server resolvers.query.node.ts, the finish() tail). The portal's
 * node editor reloads content after every save; without raw, it reloads the
 * COMPILED text (missing vars → empty), and the next save overwrites the
 * template source for good ({{age}} deleted). Both editor-feeding queries
 * must therefore read the source.
 *
 * Data-layer guard on the query text (same pattern as the NODE_FIELDS
 * memory-urn test in NodeList.test.ts) so a fragment refactor can't
 * silently drop the argument.
 */
import { describe, expect, it } from 'vitest';
import { NODE_BY_ID_QUERY, NODE_QUERY } from './queries';

describe('editor node reads request the template source (#485)', () => {
  it('NODE_BY_ID_QUERY passes raw: true', () => {
    expect(NODE_BY_ID_QUERY).toMatch(/node\(ref:\s*\$ref,\s*raw:\s*true\)/);
  });

  it('NODE_QUERY passes raw: true', () => {
    // #542: node(memory:) renamed to node(memoryRef:).
    expect(NODE_QUERY).toMatch(/node\(ref:\s*\$ref,\s*memoryRef:\s*\$memoryRef,\s*raw:\s*true\)/);
  });
});
