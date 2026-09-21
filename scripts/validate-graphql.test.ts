import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper, no type declarations by design.
import { MIN_MARKED_DOCUMENTS, ROOT, collectCommentTerminated, collectPortalDocuments, collectUnmarkedDocuments, extractDocuments, findArgVariableMismatches, findCommentTerminatedDocuments, findInvalid, findUnmarkedDocuments, resolveInterpolations } from './validate-graphql.mjs';

const schema = buildSchema(readFileSync(join(ROOT, 'schema', 'schema.graphql'), 'utf8'));

interface Doc {
  name: string;
  body: string;
  file: string;
  line: number;
}

const docs = (source: string): Doc[] => extractDocuments('test.ts', source);
const byName = (list: Doc[]) => new Map(list.map((d) => [d.name, d]));

describe('extractDocuments', () => {
  it('finds exported and module-local GraphQL literals, with their line numbers', () => {
    const found = docs(`
export const A = /* GraphQL */ \`
  query A { me { id } }
\`;

const B = /* GraphQL */ \`query B { me { id } }\`;
`);
    expect(found.map((d) => d.name)).toEqual(['A', 'B']);
    expect(found[0].line).toBe(2);
    expect(found[1].line).toBe(6);
  });

  it('ignores template literals that are not marked as GraphQL', () => {
    expect(docs('const NOT_GQL = `query A { me { id } }`;')).toEqual([]);
  });

  it('throws rather than silently skipping an unterminated literal', () => {
    expect(() => docs('const A = /* GraphQL */ `query A { me { id } }')).toThrow(/unterminated/);
  });
});

describe('resolveInterpolations', () => {
  it('splices fragments in recursively', () => {
    const list = docs(`
const INNER = /* GraphQL */ \`fragment Inner on Memory { id }\`;
const OUTER = /* GraphQL */ \`\${INNER}
fragment Outer on Memory { ...Inner }\`;
const OP = /* GraphQL */ \`\${OUTER}
query Q { memories { items { ...Outer } } }\`;
`);
    const resolved = resolveInterpolations(byName(list).get('OP')!, byName(list));
    expect(resolved).toContain('fragment Inner on Memory');
    expect(resolved).toContain('fragment Outer on Memory');
    expect(resolved).not.toContain('${');
  });

  it('rejects an interpolation that names no known document', () => {
    const list = docs('const OP = /* GraphQL */ `${MISSING}\nquery Q { me { id } }`;');
    expect(() => resolveInterpolations(list[0], byName(list))).toThrow(/not a GraphQL document/);
  });

  it('rejects a circular interpolation instead of recursing forever', () => {
    const list = docs(`
const A = /* GraphQL */ \`\${B} fragment A on Memory { id }\`;
const B = /* GraphQL */ \`\${A} fragment B on Memory { id }\`;
`);
    expect(() => resolveInterpolations(list[0], byName(list))).toThrow(/circular/);
  });
});

// The point of the gate. Each case is a drift shape that actually shipped, or
// could: if findInvalid ever returns [] for these, the gate has stopped working
// and #681 regresses silently.
describe('findInvalid catches real drift', () => {
  it('flags an unknown argument — the hadron-server#542 runTask(urn:) shape', () => {
    const failures = findInvalid(
      schema,
      docs('const OP = /* GraphQL */ `mutation R($urn: String!) { runTask(urn: $urn) }`;'),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].errors.join(' ')).toMatch(/Unknown argument "urn"/);
  });

  it('flags a mutation the server no longer defines — the addToMyMemories shape', () => {
    const failures = findInvalid(
      schema,
      docs('const OP = /* GraphQL */ `mutation A($memoryId: ID!) { addToMyMemories(memoryId: $memoryId) }`;'),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].errors.join(' ')).toMatch(/Cannot query field "addToMyMemories"/);
  });

  it('flags a field that does not exist on a selected type', () => {
    const failures = findInvalid(
      schema,
      docs('const OP = /* GraphQL */ `query Q { memories { items { notAField } } }`;'),
    );
    expect(failures).toHaveLength(1);
  });

  it('flags a bad field inside an interpolated fragment, not just at the top level', () => {
    const list = docs(`
const F = /* GraphQL */ \`fragment F on Memory { definitelyNotAField }\`;
const OP = /* GraphQL */ \`\${F}
query Q { memories { items { ...F } } }\`;
`);
    const failures = findInvalid(schema, list);
    // Once standalone, once through the operation that spreads it.
    expect(failures.map((f) => f.name).sort()).toEqual(['F', 'OP']);
  });

  it('reports a syntax error instead of throwing', () => {
    const failures = findInvalid(schema, docs('const OP = /* GraphQL */ `query Q { me {{ }`;'));
    expect(failures).toHaveLength(1);
    expect(failures[0].errors.join(' ')).toMatch(/Syntax Error/);
  });

  it('passes a well-formed operation', () => {
    expect(findInvalid(schema, docs('const OP = /* GraphQL */ `query Q { memories { total } }`;'))).toEqual([]);
  });
});

// The convention the #681 sweep unified: an argument and its $variable share a
// name. The one-line comment above APP_KEYS_QUERY claims the gate enforces
// this, so the gate had better actually fail when it is violated.
describe('findArgVariableMismatches', () => {
  const check = (src: string) =>
    findArgVariableMismatches(extractDocuments('t.ts', src), (d: { body: string }) => d.body);

  it('accepts an argument whose variable shares its name', () => {
    expect(check('const A = /* GraphQL */ `query A($ref: ID!) { thing(ref: $ref) { id } }`;')).toEqual([]);
  });

  it('rejects the pre-sweep spelling appKeys(appRef: $appId)', () => {
    const failures = check('const A = /* GraphQL */ `query A($appId: ID!) { appKeys(appRef: $appId) { id } }`;');
    expect(failures).toHaveLength(1);
    expect(failures[0].errors[0]).toMatch(/fills "appRef:" with \$appId — name the variable \$appRef/);
  });

  it('rejects updateAgent(ref: $id)', () => {
    expect(check('const A = /* GraphQL */ `mutation A($id: ID!) { updateAgent(ref: $id) { id } }`;')).toHaveLength(1);
  });

  it('ignores literal arguments — only $variables are subject to the rule', () => {
    expect(check('const A = /* GraphQL */ `query A { node(ref: "x", raw: true) { id } }`;')).toEqual([]);
  });
});

describe('the portal itself', () => {
  it('has every committed operation validating against the schema snapshot', () => {
    const documents = collectPortalDocuments();
    // Guards against the extractor silently matching nothing and the gate
    // "passing" on an empty set.
    expect(documents.length).toBeGreaterThan(100);
    expect(findInvalid(schema, documents)).toEqual([]);
  });

  it('names every argument and its $variable alike (#681 sweep)', () => {
    const documents = collectPortalDocuments();
    const byName = new Map(documents.map((d: { name: string }) => [d.name, d]));
    expect(findArgVariableMismatches(documents, (d: unknown) => resolveInterpolations(d, byName))).toEqual([]);
  });
});

/**
 * #751 — the backtick guard.
 *
 * The rule it enforces is `extractDocuments`' own documented precondition: a
 * GraphQL body never contains a nested backtick. A BARE backtick inside a `#`
 * comment terminates the tagged template literal; the build then fails on the
 * NEXT line naming the wrong thing, and every route test importing queries.ts
 * dies at once.
 *
 * A gate that cannot fail is worse than no gate, so these prove it FAILS on the
 * real shape — including the two comments that actually caused it — before
 * proving it stays quiet on everything legitimate.
 *
 * FIXTURES ARE BUILT FROM LINES, not written as template literals, and the
 * reason is the bug itself: a bare backtick cannot appear inside a template
 * literal, which is precisely why it ends one. Writing `\`` instead would be an
 * ESCAPED backtick, which does not terminate anything — a fixture that cannot
 * reproduce the defect, quietly passing. (That is the first version of this
 * test, and it failed for exactly that reason.)
 */
const BT = String.fromCharCode(96);
const lines = (...rows: string[]) => rows.join('\n');

describe('findCommentTerminatedDocuments catches a bare backtick anywhere in a GraphQL body', () => {
  const find = (source: string) => findCommentTerminatedDocuments('test.ts', source);

  it('flags the shape, and points at the comment rather than the const', () => {
    const found = find(
      lines(
        '',
        `export const A = /* GraphQL */ ${BT}`,
        '  query A {',
        `    # do not touch ${BT}me${BT} here`,
        '    me { id }',
        '  }',
        `${BT};`,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('A');
    // Line 4 — where the literal actually ended, which is the one place the
    // compiler's own error will NOT point.
    expect(found[0].line).toBe(4);
    expect(found[0].errors.join(' ')).toMatch(/ends the GraphQL template literal early/);
  });

  it('flags the two comments that actually caused this, verbatim', () => {
    // PR #749 and PR #752, kept literally: a paraphrase would be a fixture of
    // my memory of the bug rather than of the bug.
    const first = find(
      lines(
        `export const F = /* GraphQL */ ${BT}`,
        '  fragment WorkerFields on Worker {',
        `    # DO NOT add these to a ${BT}Session.worker${BT} selection. That path is wider.`,
        '    heldByUserId',
        '  }',
        `${BT};`,
      ),
    );
    const second = find(
      lines(
        `export const Q = /* GraphQL */ ${BT}`,
        '  query Q {',
        `    # merge, which cannot reproduce ${BT}total${BT} or a stable offset on`,
        '    teamWorkItems { total }',
        '  }',
        `${BT};`,
      ),
    );
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('is silent on a correctly terminated document', () => {
    expect(
      find(
        lines(
          `export const A = /* GraphQL */ ${BT}`,
          '  query A {',
          '    # plain prose about total, with no backticks',
          '    me { id }',
          '  }',
          `${BT};`,
        ),
      ),
    ).toEqual([]);
  });

  it('does not fire on an ESCAPED backtick, which terminates nothing', () => {
    // \` inside a template literal is a legal character, not an end. Treating it
    // as one would reject valid source.
    expect(
      find(
        lines(
          `export const A = /* GraphQL */ ${BT}`,
          '  query A {',
          '    # an escaped \\` is fine here',
          '    me { id }',
          '  }',
          `${BT};`,
        ),
      ),
    ).toEqual([]);
  });

  it('flags a TRAILING comment, where the line does not start with #', () => {
    // Codex P2 on #757. GraphQL comments run to end-of-line, so a backtick in a
    // trailing comment terminates just as early — and the earlier guard, which
    // tested `line.trimStart().startsWith('#')`, could not see it.
    const found = find(
      lines(
        `export const A = /* GraphQL */ ${BT}`,
        `  query A { me { id } } # mention ${BT}me${BT}`,
        `${BT};`,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
  });

  it('flags a backtick outside a comment entirely', () => {
    // The rule is the precondition — no nested backtick — not "no backtick in a
    // comment". A description string is just as fatal.
    const found = find(
      lines(
        `export const A = /* GraphQL */ ${BT}`,
        `  query A { me { id } } ${BT} trailing junk`,
        `${BT};`,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].errors[0]).toMatch(/^a backtick here ends/);
  });

  it('accepts a single-line document, which closes on its opening line', () => {
    // The one legitimate shape where the terminator is not first on its line.
    expect(find(`const B = /* GraphQL */ ${BT}query B { me { id } }${BT};`)).toEqual([]);
  });

  // #774. POSITION was the whole test until this pair, and each of these
  // returned [] — a tick — on source that does not compile. Reported by @Dara
  // off hadron-server#1076, where the port of this check hit the same hole.
  it('flags a stray backtick FIRST on its line, which position alone accepted', () => {
    // A wrapped # comment continuing with a markdown code span. The stray is
    // the first thing on its line, so it looked exactly like `` `; ``.
    const found = find(
      lines(
        `export const A = /* GraphQL */ ${BT}`,
        '  query A { me { id } }',
        `${BT}Session.userId${BT} for why`,
        `${BT};`,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
    // Both readings, not just "remove the backticks" — which, on a line that
    // resembles a terminator, reads as advice to delete a real one.
    expect(found[0].errors.join(' ')).toMatch(/resembles a real close/);
  });

  it('flags a stray backtick inside a SINGLE-LINE document, which the same-line rule accepted', () => {
    const found = find(
      `const B = /* GraphQL */ ${BT}query B { me { id } } # see ${BT}me${BT}${BT};`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].errors.join(' ')).toMatch(/resembles a real close/);
    // And it must NOT claim the document is single-line. The scan stopped at
    // the FIRST backtick, so it has not found the real close and cannot know
    // where it is — a multi-line document whose stray happens to sit on the
    // opening line reaches this same branch. A confidently wrong sentence
    // inside the artifact whose job is explaining a confusing failure is the
    // defect this repo keeps paying for, not a wording nit.
    expect(found[0].errors.join(' ')).not.toMatch(/single-line|one line/);
  });

  it('is the ONLY thing standing between these two shapes and a green gate', () => {
    // The half that makes a false ✓ fatal rather than merely untidy: what is
    // left after the stray truncates the body still PARSES and still VALIDATES,
    // so findInvalid returns nothing and `pnpm gql:validate` exits 0 while the
    // TypeScript build is broken. Measured, not reasoned.
    const source = lines(
      `export const A = /* GraphQL */ ${BT}`,
      '  query A { me { id } }',
      `${BT}Session.userId${BT} for why`,
      `${BT};`,
    );
    expect(findInvalid(schema, docs(source))).toEqual([]);
    expect(find(source)).toHaveLength(1);
  });

  it('accepts every terminator shape the declaration matcher can actually produce', () => {
    // Prove the SPARE, not just the FIRE — but only for tails that REACH this
    // check. All 180 documents under src/ close with `` `; ``; a `,` continues
    // a multi-declarator const; ASI allows none at all; and a trailing //
    // comment must not be read as prose running past the close.
    //
    // Each of these is scanned, which the earlier `gql(/* GraphQL */ …)`
    // fixture was not: `declaration` requires /* GraphQL */ to follow `=`
    // directly, so that source produced no documents and the assertion held
    // whatever TERMINATOR_TAIL said. Both review bots caught it independently.
    // The rule now admits nothing the matcher cannot reach, so there is no
    // shape left to assert vacuously.
    expect(find(lines(`const A = /* GraphQL */ ${BT}`, '  query A { me { id } }', `${BT};`))).toEqual([]);
    expect(
      find(lines(`const B = /* GraphQL */ ${BT}`, '  query B { me { id } }', `${BT},`, '  OTHER = 2;')),
    ).toEqual([]);
    expect(find(lines(`const C = /* GraphQL */ ${BT}`, '  query C { me { id } }', `${BT}`))).toEqual([]);
    expect(
      find(lines(`const D = /* GraphQL */ ${BT}`, '  query D { me { id } }', `${BT}; // #681`)),
    ).toEqual([]);
  });

  it('is scanning each of those fixtures, not silently skipping them', () => {
    // The other half of the finding: a spare test proves nothing unless the
    // fixture reaches the matcher. Planting a blatant stray in each shape must
    // FIRE — that is what the `gql(` fixture could not do, and how it stayed
    // green while asserting a rule it never exercised.
    const withStray = (name: string, close: string) =>
      lines(
        `const ${name} = /* GraphQL */ ${BT}`,
        `  query ${name} { me { id } } # ${BT}x${BT}`,
        close,
      );
    expect(find(withStray('A', `${BT};`))).toHaveLength(1);
    expect(find(withStray('B', `${BT},`))).toHaveLength(1);
    expect(find(withStray('C', BT))).toHaveLength(1);
    expect(find(withStray('D', `${BT}; // #681`))).toHaveLength(1);
  });

  it('still flags a stray at the END of a line, which the shape rule alone would accept', () => {
    // The shape rule sees nothing after this backtick and would call it a
    // close; POSITION is what catches it. Both halves are load-bearing.
    const found = find(
      lines(
        `export const A = /* GraphQL */ ${BT}`,
        '  query A {',
        `    # do not touch me here ${BT}`,
        '    me { id }',
        '  }',
        `${BT};`,
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
  });

  it('does not fire on a legitimate fragment interpolation', () => {
    expect(
      find(
        lines(
          `export const A = /* GraphQL */ ${BT}`,
          '  ${FIELDS}',
          '  query A { me { ...Fields } }',
          `${BT};`,
        ),
      ),
    ).toEqual([]);
  });

  it('ignores backticks in the TypeScript around the document', () => {
    // Template literals elsewhere in the file are none of this check's business.
    expect(
      find(
        lines(
          `const url = ${BT}/app/workers/\${id}${BT};`,
          `export const A = /* GraphQL */ ${BT}`,
          '  query A { me { id } }',
          `${BT};`,
          `const msg = ${BT}done${BT};`,
        ),
      ),
    ).toEqual([]);
  });

  it('keeps checking documents that FOLLOW an offender', () => {
    // The scan resumes past a premature terminator, so one bad comment must not
    // hide a second further down the file.
    const found = find(
      lines(
        `export const A = /* GraphQL */ ${BT}`,
        '  query A {',
        `    # bad ${BT}one${BT}`,
        '    me { id }',
        '  }',
        `${BT};`,
        `export const B = /* GraphQL */ ${BT}`,
        '  query B {',
        `    # bad ${BT}two${BT}`,
        '    me { id }',
        '  }',
        `${BT};`,
      ),
    );
    expect(found.map((f: { name: string }) => f.name)).toEqual(['A', 'B']);
  });
});

describe('the portal itself has no comment-terminated documents', () => {
  it('is clean today', () => {
    expect(collectCommentTerminated()).toEqual([]);
  });

  // Plant into the REAL file rather than a hand-written fixture. Every case
  // this check has missed was an idiom already written in the source it
  // protects, and a fixture is a fixture of what I remembered to write.
  //
  // Driven through collectCommentTerminated — the walker CI calls — not the
  // inner matcher: "is clean today" above returns [] just as happily when the
  // walk selects NOTHING, which is hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven's
  // green-gate-on-an-empty-set. This is the case that proves the walk reaches
  // queries.ts and still bites there.
  it('names the planted line, through the walker, when the defect is put into the real queries.ts', () => {
    const real = readFileSync(join(ROOT, 'src', 'lib', 'server', 'queries.ts'), 'utf8').split('\n');
    // The first real terminator, so the plant lands inside a document body.
    const closing = real.findIndex((l) => l.trim() === `${BT};`);
    expect(closing).toBeGreaterThan(0);

    const planted = [...real];
    planted.splice(closing, 0, `${BT}Session.userId${BT} for why`);

    const dir = mkdtempSync(join(tmpdir(), 'gql-guard-'));
    try {
      mkdirSync(join(dir, 'lib', 'server'), { recursive: true });
      writeFileSync(join(dir, 'lib', 'server', 'queries.ts'), planted.join('\n'));
      const found = collectCommentTerminated(dir);
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].line).toBe(closing + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * #872 — the unmarked-document check.
 *
 * `extractDocuments` finds documents by their `/* GraphQL *\/` marker, so one
 * without it is validated by NOTHING: not the schema check, not the caller
 * check, not the naming rule. Eight existed while `gql:validate` reported
 * "200 documents, 0 invalid" — a count that reads as complete and was eight
 * short. Marking them raised it to 208 and brought 36 more call sites under
 * variable checking.
 *
 * Both directions, always: what it FAILS on, and what it stays silent on and
 * why. A check that only ever reports "nothing unmarked" cannot be told apart
 * from one that has stopped looking.
 */
const unmarked = (source: string) => findUnmarkedDocuments('test.ts', source);

describe('findUnmarkedDocuments', () => {
  it.each([
    ['a query', 'const Q = `query Thing($ref: ID!) { thing(ref: $ref) { id } }`;'],
    ['a mutation', 'const M = `mutation Do($input: DoInput!) { do(input: $input) { id } }`;'],
    ['a fragment', 'const F = `fragment ThingFields on Thing { id name }`;'],
    [
      'an operation with a fragment interpolated in front of it',
      'const Q = `${FIELDS}\n  query Thing { thing { ...ThingFields } }`;',
    ],
  ])('fails %s declared without the marker', (_what, code) => {
    expect(unmarked(code)).toHaveLength(1);
  });

  it('stays silent on the same document WITH the marker', () => {
    expect(
      unmarked('const Q = /* GraphQL */ `query Thing($ref: ID!) { thing(ref: $ref) { id } }`;'),
    ).toEqual([]);
  });

  // The predicate PARSES rather than pattern-matches, so prose that happens to
  // use the words is not a document. A check that guessed from keywords would
  // fire on ordinary strings and teach people to avoid the vocabulary.
  it.each([
    ['prose mentioning a query', 'const msg = `Your query returned no results.`;'],
    ['a SQL statement', 'const sql = `select id from nodes where loc = $1`;'],
    ['an empty literal', 'const empty = ``;'],
    ['GraphQL type defs with no operation', 'const sdl = `type Thing { id: ID! }`;'],
  ])('stays silent on %s', (_what, code) => {
    expect(unmarked(code)).toEqual([]);
  });

  // Matched on the AST, so a comment ABOUT a document is not a document —
  // otherwise the gate makes explaining the rule a violation of it.
  it('stays silent on a comment describing an unmarked document', () => {
    expect(
      unmarked('// A `query Thing { id }` used to live here, unmarked.\nconst x = 1;'),
    ).toEqual([]);
  });

  /**
   * The gate asks what the literal IS, not how it was declared.
   *
   * The first cut matched a `const` initialiser — the shape the eight known
   * offenders happened to have. Every row below is a document this repo could
   * plausibly grow, and every one of them walked past that version;
   * `client.request(`query …`)` written inline is the likeliest ninth and the
   * furthest from a `const`. None were live in `src/` when this widened, so
   * the hole was latent rather than open — which is precisely why nothing
   * would have prompted anyone to look.
   *
   * hrn:node:hadronmemory.com:hadron-portal:review:gate-the-import-not-the-call-site
   * from a third direction: a gate keyed on a thing's NAME or SHAPE is beaten
   * by writing the same thing another way.
   */
  it.each([
    ['passed inline to request()', 'await client.request(`query A { me { id } }`, vars);'],
    ['an object-literal property', 'const docs = { a: `query B { me { id } }` };'],
    ['a class property', 'class X { q = `query C { me { id } }`; }'],
    ['returned from a function', 'function d() { return `query D { me { id } }`; }'],
    ['an export default', 'export default `query E { me { id } }`;'],
    ['an arrow body', 'const mk = () => `query F { me { id } }`;'],
  ])('fails a document %s, which no const declaration wraps', (_what, code) => {
    expect(unmarked(code)).toHaveLength(1);
  });

  // The marker still exempts it in those positions — the rule is the marker,
  // not the shape, in both directions. A widening that could not be satisfied
  // by marking would just be a ban on writing documents inline.
  it.each([
    ['inline', 'await client.request(/* GraphQL */ `query A { me { id } }`, vars);'],
    ['as a property', 'const docs = { a: /* GraphQL */ `query B { me { id } }` };'],
  ])('stays silent on a marked document %s', (_what, code) => {
    expect(unmarked(code)).toEqual([]);
  });

  // Named where a name exists, positional where none does. An inline document
  // has no binding to report, and reporting it as `undefined` would read as a
  // bug in the gate rather than as the point.
  it('reports a binding by name and an inline document by position', () => {
    expect(unmarked('const Q = `query A { me { id } }`;')[0]).toMatchObject({ name: 'Q' });
    expect(unmarked('await client.request(`query A { me { id } }`);')[0])
      .toMatchObject({ name: '(inline)', line: 1 });
  });
});

describe('collectUnmarkedDocuments — the repository as it stands', () => {
  const { unmarked: found, marked } = collectUnmarkedDocuments();

  it('has no unmarked documents', () => {
    expect(found).toEqual([]);
  });

  /**
   * The anti-vacuity floor. Without it, breaking the walk — or the marker
   * regex — leaves this check reporting "nothing unmarked" forever, which is
   * indistinguishable from a clean tree. Asserted as a COUNT, not merely as an
   * absence of failures.
   */
  it('sees the corpus it claims to', () => {
    expect(marked).toBeGreaterThanOrEqual(MIN_MARKED_DOCUMENTS);
  });
});
