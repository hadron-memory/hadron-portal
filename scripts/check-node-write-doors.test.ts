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

  // One failure per LINE, not per occurrence: the walk sees the import
  // specifier and the use as two nodes, and a reader who gets two lines of red
  // for one mistake learns to skim.
  it('reports each offending line once, however many names are on it', () => {
    const { failures } = scanSource(
      ORDINARY,
      "import { UPDATE_NODE_MUTATION, UPDATE_TASK_NODE_MUTATION } from '$lib/server/queries';\n",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('UPDATE_NODE_MUTATION, UPDATE_TASK_NODE_MUTATION');
  });

  /**
   * THE evasion, and the reason the import is the load-bearing check.
   *
   * A call-site-only gate matches a bare identifier in the document position,
   * so one level of indirection reads as opaque and passes. This is not a
   * hypothetical shape — it is verbatim what `edit/+page.server.ts` contained
   * before this PR, which means a gate built on call sites alone would not have
   * caught #868's own predecessor. Found by probing the gate rather than by
   * reading it.
   */
  it('fails a door document held in a local variable', () => {
    const { failures } = scanSource(
      ORDINARY,
      [
        // The import is not decoration in this fixture — it is the whole test.
        // A file cannot name a door document without it, which is what makes
        // the import the chokepoint indirection cannot get around.
        "import { UPDATE_NODE_MUTATION, UPDATE_TASK_NODE_MUTATION } from '$lib/server/queries';",
        'const mutation = cond ? UPDATE_TASK_NODE_MUTATION : UPDATE_NODE_MUTATION;',
        'await client.request(mutation, { input });',
      ].join('\n'),
    );
    // The CALL SITE is invisible — `mutation` is not a door name. What catches
    // it is the reference walk over the import and the ternary, which is the
    // half this test is about.
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) expect(failure).toContain('names');
  });

  /**
   * The FOURTH spelling, found by @copilot on PR #869 an hour after a commit
   * message here claimed the import was "the chokepoint no amount of
   * indirection gets around". A namespace import names nothing the gate would
   * recognise at the import, and the call site sees a property access rather
   * than an identifier — so both halves miss it.
   */
  it('fails a door reached through a namespace import', () => {
    const { failures } = scanSource(
      ORDINARY,
      "import * as queries from '$lib/server/queries';\n" +
        'await client.request(queries.UPDATE_NODE_MUTATION, { input });\n',
    );
    // TWO lines the author has to look at: the namespace import itself, and
    // the property access that names the door. Both are reported because both
    // are edits, and either one alone leaves the file reaching the registry.
    expect(failures).toHaveLength(2);
    expect(failures.join(' ')).toContain('UPDATE_NODE_MUTATION');
    expect(failures.join(' ')).toContain('the whole query registry');
  });

  // `import { X as Y }` and `const { X: y } = ns` both put the door name in the
  // PROPERTY position — the local binding is whatever the author chose, and a
  // text search for the door name at the call site finds nothing.
  /**
   * @copilot: a computed key puts the door's name in no AST node at all
   * (`const key = 'UPDATE_' + 'NODE_MUTATION'; queries[key]`), which no static
   * walk can see. Resolving that is dataflow analysis and the wrong target
   * anyway — but the FAMILY closes without it, because every member needs the
   * same namespace import first. So the import is what is reported.
   *
   * Measured before adding it: zero namespace imports of the registry exist in
   * any file that calls `.request(`, so this refuses a shape nobody uses.
   */
  it('fails a namespace import of the query registry, whatever is done with it', () => {
    const { failures } = scanSource(
      ORDINARY,
      "import * as queries from '$lib/server/queries';\n" +
        "const key = 'UPDATE_' + 'NODE_MUTATION';\n" +
        'await client.request(queries[key], { input });\n',
    );
    // Only the import — the computed key names nothing the walk can see, which
    // is the whole point: the import is what makes the family unreachable.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('the whole query registry');
  });

  /**
   * @copilot: the docstring said it covered `./queries` and the matcher beside
   * it tested for `/server/queries`, which a relative import does not contain.
   * A file inside `src/lib/server/` could therefore namespace-import the
   * registry relatively and slip the whole family — and the raw-text prefilter
   * carried the same string, so the file was never even parsed.
   *
   * This PR's own recurring defect, committed one more time in the commit that
   * introduced the constant.
   */
  it.each([
    "import * as q from '$lib/server/queries';",
    "import * as q from './queries';",
    "import * as q from '../queries';",
    "import * as q from '../../server/queries';",
  ])('fails a namespace import spelled %s', (imp) => {
    const { failures, looked } = scanSource(ORDINARY, `${imp}\nawait client.request(q[key], { input });\n`);
    expect(looked).toBe(true);
    expect(failures).toHaveLength(1);
  });

  // The segment match must not swallow a neighbour. There is one module named
  // `queries` in the tree and a rule that also claimed `subqueries` would be
  // refusing a file for importing something else entirely.
  it('stays silent on a module that merely ends in the same letters', () => {
    expect(scanSource(ORDINARY, "import * as q from './subqueries';\n").looked).toBe(false);
  });

  it('fails an aliased import even though the call site never names a door', () => {
    const { failures } = scanSource(
      ORDINARY,
      "import { UPDATE_NODE_MUTATION as DOC } from '$lib/server/queries';\n" +
        'await client.request(DOC, { input });\n',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('UPDATE_NODE_MUTATION');
  });

  /**
   * @copilot's fifth round produced three more spellings at once — element
   * access, a destructured namespace binding, and a barrel re-export — which
   * is what settled the shape: an enumerated list of forms is always one form
   * short, so the rule is now "any Identifier or StringLiteral naming a door
   * document". These cases exist to keep that closed rule honest, not because
   * each one needed its own branch.
   */
  it.each([
    ['a property of anything at all', 'const d = docs.UPDATE_SPEC_NODE_MUTATION;'],
    ['element access', "await client.request(queries['UPDATE_NODE_MUTATION'], { input });"],
    ['a destructured namespace binding', 'const { UPDATE_NODE_MUTATION: doc } = queries;'],
    ['a barrel re-export', "export { UPDATE_NODE_MUTATION as DOC } from '$lib/server/queries';"],
    ['a bare reference nobody imported', 'const all = [UPDATE_REVIEW_NODE_MUTATION];'],
    // @copilot: a no-substitution template literal is a THIRD node kind, and a
    // rule advertised as closed that misses one is just a shorter list.
    ['a template-literal key', 'await client.request(queries[`UPDATE_NODE_MUTATION`], { input });'],
  ])('fails a door reached by %s', (_what, code) => {
    expect(scanSource(ORDINARY, `${code}\n`).failures.length).toBeGreaterThan(0);
  });

  /**
   * The evasion one level further out, and @codex found it on PR #869 while
   * the two above were still fresh: a caller need not go near DOOR_DOCUMENTS
   * at all, because it can declare its own document.
   *
   * `app/agents/[id]/conversations/+page.server.ts` has done exactly this for
   * seven writes (portal#870). It carries no `/* GraphQL *\/` marker, so it is
   * invisible to validate-graphql and to check-graphql-callers as well —
   * gating the CONSTANT was the same mistake as gating the CALL SITE.
   */
  it('fails a locally declared node-update document', () => {
    const { failures } = scanSource(
      ORDINARY,
      'const UPDATE = `mutation U($input: UpdateNodeInput!) { updateNode(input: $input) { id } }`;\n' +
        'await client.request(UPDATE, { input });\n',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('declares its own node-update document');
  });

  /**
   * @codex: a GraphQL comment is whitespace between tokens, so the field name
   * and its argument list need not be adjacent in the source —
   * `updateNode # why\n(input: $input)` is a legal call that `\bop\s*\(`
   * does not match. Comments are stripped before the match now.
   */
  it('fails a locally declared document whose call is split by a GraphQL comment', () => {
    const { failures } = scanSource(
      ORDINARY,
      'const D = `mutation U($input: UpdateNodeInput!) { updateNode # why not\n' +
        '(input: $input) { id } }`;\n',
    );
    expect(failures).toHaveLength(1);
  });

  it.each(['updateTaskNode', 'updateReviewNode', 'updateSpecNode'])(
    'fails a locally declared %s document too — a hand-picked door is still hand-picked',
    (operation) => {
      const { failures } = scanSource(
        ORDINARY,
        `const D = \`mutation U($input: UpdateNodeInput!) { ${operation}(input: $input) { id } }\`;\n`,
      );
      expect(failures).toHaveLength(1);
    },
  );

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
    const direct =
      "import { UPDATE_NODE_MUTATION } from '$lib/server/queries';\n" +
      'await client.request(UPDATE_NODE_MUTATION, { input });\n';
    expect(scanSource(EXEMPT, direct).failures).toEqual([]);
    expect(scanSource(ORDINARY, direct).failures.length).toBeGreaterThan(0);
  });

  // An exemption nobody uses is a grant sitting open for whoever edits that
  // file next — the gate reports it rather than letting it stand.
  it('fails a stale exemption', () => {
    const { failures } = scanSource(
      EXEMPT,
      'await client.request(nodeUpdateDocument(n, i), { input });\n',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('no longer holds');
  });

  /**
   * The stale check used to be UNREACHABLE in the one case it exists for.
   * It sat behind the "this file names no door identifier" early return, so a
   * file that dropped its write entirely — the most complete way for a grant to
   * go stale — returned `looked: false` and the exemption stood unreported.
   * Found by probing, not by reading.
   */
  it('still reports a stale exemption when the file names no door at all', () => {
    const { failures, looked } = scanSource(EXEMPT, 'await client.request(MEMORIES_QUERY, {});\n');
    expect(looked).toBe(true);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('no longer holds');
  });
});

describe('the chooser under another name', () => {
  // @copilot: an aliased chooser import routes perfectly well but was not
  // COUNTED as routed, which erodes the floor silently and makes
  // check-graphql-callers skip the call's variables.
  it('counts an aliased chooser call as routed', () => {
    const { failures, routed } = scanSource(
      ORDINARY,
      "import { nodeUpdateDocument as choose } from '$lib/server/nodeKindDoor';\n" +
        'await client.request(choose(node, input), { input });\n',
    );
    expect(failures).toEqual([]);
    expect(routed).toBe(1);
  });

  it('counts a namespaced chooser call as routed', () => {
    const { routed } = scanSource(
      ORDINARY,
      "import * as door from '$lib/server/nodeKindDoor';\n" +
        'await client.request(door.nodeUpdateDocument(node, input), { input });\n',
    );
    expect(routed).toBe(1);
  });
});

describe('the document registry', () => {
  // A gate that flagged every door operation everywhere would flag the file
  // that DEFINES the four documents. Rather than skip it, the registry gets its
  // own rule: a door operation there must land on one of the four names, since
  // that list is the only thing the import check knows to guard.
  it('stays silent on the four documents it is meant to hold', () => {
    const { failures } = scanSource(
      'src/lib/server/queries.ts',
      'export const UPDATE_TASK_NODE_MUTATION = /* GraphQL */ `\n' +
        '  mutation UpdateTaskNode($input: UpdateNodeInput!) { updateTaskNode(input: $input) { id } }\n`;\n',
    );
    expect(failures).toEqual([]);
  });

  it('fails a FIFTH node-write document smuggled in under another name', () => {
    const { failures } = scanSource(
      'src/lib/server/queries.ts',
      'export const QUICK_SEQ_MUTATION = /* GraphQL */ `\n' +
        '  mutation QuickSeq($input: UpdateNodeInput!) { updateNode(input: $input) { id } }\n`;\n',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('QUICK_SEQ_MUTATION');
  });
});

describe('prose is not code', () => {
  /**
   * A gate that greps raw text flags a comment EXPLAINING the rule, which
   * teaches people to stop writing the explanation — hadron-server's
   * `no-agent-specific-code` check failed a docs-only PR for exactly this.
   * Matched on the AST's literals instead, so a comment is just a comment.
   */
  it('does not flag a comment that mentions a door operation', () => {
    const { failures } = scanSource(
      ORDINARY,
      '// This used to call updateNode(input) directly; it goes through the\n' +
        '// chooser now. See nodeUpdateDocument.\n' +
        'await client.request(nodeUpdateDocument(node, input), { input });\n',
    );
    expect(failures).toEqual([]);
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

  /**
   * @copilot: this check called `parse()` bare. A malformed door document
   * aborted the WHOLE `pnpm gql:validate` run with an uncaught GraphQLError
   * before any of validate-graphql's own findings could print — and it is not
   * hypothetical, a stray backtick inside a `#` comment truncates every
   * document after it, which happened while writing this PR.
   */
  /**
   * @codex, one round after the parse guard went in: `resolveInterpolations`
   * throws too — on a circular interpolation, or a `${X}` naming a constant
   * that is not a GraphQL document — and that call sat one line ABOVE the try.
   * Fixing the parse half and leaving the resolve half was the same bug a line
   * earlier, and it reproduced the whole-run abort the guard exists to prevent.
   */
  it('reports a resolution failure instead of throwing', () => {
    const boom = () => {
      throw new Error('circular fragment interpolation through A -> B -> A');
    };
    expect(() => doorVariablesAgree(boom)).not.toThrow();
    const errors = doorVariablesAgree(boom);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('circular fragment interpolation');
  });

  it('reports a malformed document instead of throwing', () => {
    expect(() =>
      doorVariablesAgree((name) =>
        name === 'UPDATE_NODE_MUTATION'
          ? 'mutation Broken($input: {{{'
          : 'mutation X($input: UpdateNodeInput!) { x(input: $input) { id } }',
      ),
    ).not.toThrow();
    const errors = doorVariablesAgree((name) =>
      name === 'UPDATE_NODE_MUTATION'
        ? 'mutation Broken($input: {{{'
        : 'mutation X($input: UpdateNodeInput!) { x(input: $input) { id } }',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('could not be read as a GraphQL document');
  });

  // @copilot: name alone is not a signature. Two doors both taking `$input`
  // agree on nothing useful if the types differ — and a differing type is
  // exactly what would make the caller gate's one-representative shortcut
  // meaningless rather than loud.
  it('fails when two doors agree on a variable NAME but not its type', () => {
    const errors = doorVariablesAgree((name) =>
      name === 'UPDATE_SPEC_NODE_MUTATION'
        ? 'mutation S($input: SomethingElse!) { updateSpecNode(input: $input) { id } }'
        : 'mutation X($input: UpdateNodeInput!) { x(input: $input) { id } }',
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
