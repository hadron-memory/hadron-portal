import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  ALLOWED,
  DOOR_DOCUMENTS,
  DOOR_MODULE,
  MIN_ROUTED_CALL_SITES,
  doorVariablesAgree,
  findDoorViolations,
  isTestFile,
  scanSource,
} from './check-node-write-doors.mjs';
import { collectPortalDocuments, resolveInterpolations, sourceFiles } from './validate-graphql.mjs';

/**
 * #868 — the gate's own test.
 *
 * Two directions, always. Proving the gate FAILS on the drift shape proves it
 * can fail; proving it stays SILENT on the routed shape proves the silence is a
 * verdict rather than blindness. A one-directional gate test also passes on a
 * gate that never looked, which is the false green being replaced
 * (`hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail`).
 */

const ROOT = resolve(import.meta.dirname, '..');

// A file that is in neither ALLOWED nor the chooser — i.e. an ordinary caller.
const ORDINARY = 'src/routes/app/x/+page.server.ts';
const EXEMPT = [...ALLOWED.keys()][0];

describe('scanSource — the drift shape', () => {
  it.each(DOOR_DOCUMENTS)('fails a direct %s call site', (doc) => {
    const { failures, routed } = scanSource(
      ORDINARY,
      `await client.request(${doc}, { input });\n`,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(doc);
    expect(routed).toBe(0);
  });

  // The portal annotates the response type inline on most of these, and a
  // literal `.request(` match skipped every one of those files wholesale once
  // already (portal#696). Both spellings, or the gate is blind to the majority.
  it('fails a typed .request<T>( call site', () => {
    const { failures } = scanSource(
      ORDINARY,
      'await client.request<{ updateNode: { id: string } }>(UPDATE_NODE_MUTATION, { input });\n',
    );
    expect(failures).toHaveLength(1);
  });

  // The gate's whole purpose. A call site that is refused in production because
  // it picked the generic door must be refused in CI first.
  it('fails the exact shape #868 is about — a generic write against a node it did not inspect', () => {
    const { failures } = scanSource(
      ORDINARY,
      [
        'const { node } = await client.request(NODE_BY_ID_QUERY, { ref });',
        'await client.request(UPDATE_NODE_MUTATION, {',
        '  input: { memoryId: node.memoryId, loc: node.loc, content },',
        '});',
      ].join('\n'),
    );
    expect(failures).toHaveLength(1);
  });
});

describe('scanSource — the routed shape', () => {
  it('stays silent on a routed write, and counts it', () => {
    const { failures, routed } = scanSource(
      ORDINARY,
      [
        'const input = { memoryId: node.memoryId, loc: node.loc, content };',
        'await client.request(nodeUpdateDocument(node, input), { input });',
      ].join('\n'),
    );
    expect(failures).toEqual([]);
    expect(routed).toBe(1);
  });

  // The silence has to be for a REASON. A file naming none of the identifiers
  // cannot hold a violation, because a violation has to name a door document.
  it('does not even look at a file that names no door', () => {
    expect(scanSource(ORDINARY, 'await client.request(MEMORIES_QUERY, {});\n').looked).toBe(false);
  });

  it('stays silent on an exempted file, and only there', () => {
    const direct = 'await client.request(UPDATE_NODE_MUTATION, { input });\n';
    expect(scanSource(EXEMPT, direct).failures).toEqual([]);
    expect(scanSource(ORDINARY, direct).failures).toHaveLength(1);
  });

  // An exemption nobody uses is a grant sitting open for whoever edits that
  // file next — the gate reports it rather than letting it stand.
  it('fails a stale exemption', () => {
    const { failures } = scanSource(EXEMPT, 'await client.request(nodeUpdateDocument(n, i), { input });\n');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('no longer writes a node directly');
  });
});

describe('the anti-vacuity floors', () => {
  // The failure mode this gate could have had: rip out every routed call site
  // and the "no violations" report is still clean, because there is nothing
  // left to violate. #862 is open on exactly this hole in another gate here.
  it('fails when it finds fewer routed writes than the floor', () => {
    const { failures } = findDoorViolations([], ROOT, () => undefined);
    expect(failures.some((f) => f.includes('routed node writes'))).toBe(true);
  });

  it('fails when it scanned no files at all', () => {
    const { failures } = findDoorViolations([], ROOT, () => undefined);
    expect(failures.some((f) => f.includes('scanned 0 files'))).toBe(true);
  });
});

describe('test files are not counted toward the floor', () => {
  /**
   * Found while building this, by reading the gate's own output rather than
   * its verdict: the floor read 21 routed writes when the product has 10,
   * because `nodeKindDoor.test.ts` calls the chooser in every assertion. A
   * floor a gate can satisfy out of its own test suite is not a floor — delete
   * every product call site and it would still have reported a clean, well-populated run.
   */
  it.each([
    'src/lib/server/nodeKindDoor.test.ts',
    'src/routes/app/x/page.server.test.ts',
    'src/lib/components/Thing.client.test.ts',
  ])('recognises %s as a test file', (rel) => {
    expect(isTestFile(rel)).toBe(true);
  });

  it.each([
    'src/lib/server/nodeKindDoor.ts',
    'src/routes/app/x/+page.server.ts',
    'src/lib/test/mountComponent.ts',
  ])('does not mistake %s for one', (rel) => {
    expect(isTestFile(rel)).toBe(false);
  });
});

describe('doorVariablesAgree', () => {
  // check-graphql-callers resolves `nodeUpdateDocument(...)` to ONE
  // representative operation, which is sound only while the doors agree. This
  // is the assertion that makes that shortcut safe rather than lucky — so it
  // has to be shown failing when they diverge, not only passing today.
  it('fails when a door takes a variable the others do not', () => {
    const errors = doorVariablesAgree((name) =>
      name === 'UPDATE_SPEC_NODE_MUTATION'
        ? 'mutation UpdateSpecNode($input: UpdateNodeInput!, $dryRun: Boolean) { updateSpecNode(input: $input) { id } }'
        : `mutation X($input: UpdateNodeInput!) { x(input: $input) { id } }`,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no longer declare the same variables');
  });

  it('fails when a door document has been renamed away', () => {
    expect(
      doorVariablesAgree((name) =>
        name === 'UPDATE_REVIEW_NODE_MUTATION'
          ? undefined
          : 'mutation X($input: UpdateNodeInput!) { x(input: $input) { id } }',
      ),
    ).toHaveLength(1);
  });
});

describe('the repository as it stands', () => {
  // The live run. Kept separate from the shape tests above so a red here reads
  // as "the portal drifted", not "the gate is broken".
  const documents = collectPortalDocuments();
  const byName = new Map(documents.map((doc) => [doc.name, doc]));
  const result = findDoorViolations(sourceFiles(resolve(ROOT, 'src')), ROOT, (name) => {
    const doc = byName.get(name);
    return doc === undefined ? undefined : resolveInterpolations(doc, byName);
  });

  it('has no unrouted node writes', () => {
    expect(result.failures).toEqual([]);
  });

  // The count is asserted, not just the absence of failures: a floor that the
  // repository sits exactly on is the only kind that catches a REMOVED routing.
  it('routes at least the call sites #868 named', () => {
    expect(result.routed).toBeGreaterThanOrEqual(MIN_ROUTED_CALL_SITES);
  });

  it('exempts only files that exist and still write directly', () => {
    for (const rel of ALLOWED.keys()) {
      expect(sourceFiles(resolve(ROOT, 'src')).map((f) => f.slice(ROOT.length + 1))).toContain(rel);
    }
  });

  it('keeps the door documents out of every file but the chooser', () => {
    expect(DOOR_MODULE).toBe('src/lib/server/nodeKindDoor.ts');
  });
});
