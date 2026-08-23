import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper, no type declarations by design.
import { ROOT, collectCommentTerminated, collectPortalDocuments, extractDocuments, findArgVariableMismatches, findCommentTerminatedDocuments, findInvalid, resolveInterpolations } from './validate-graphql.mjs';

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

describe('findCommentTerminatedDocuments catches a bare backtick in a # comment', () => {
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
});
