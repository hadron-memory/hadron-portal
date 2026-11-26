import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helpers, no type declarations by design.
import { declaredVariables, findCallerMismatches, findInputKeyMismatches } from './check-graphql-callers.mjs';
import { buildSchema } from 'graphql';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gql-callers-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Two documents: one with a required ref + optional name, one all-optional list.
const DOCS = [
  {
    name: 'UPDATE_THING_MUTATION',
    file: 'queries.ts',
    line: 1,
    body: 'mutation UpdateThing($ref: ID!, $name: String) { updateThing(ref: $ref, name: $name) { id } }',
  },
  {
    name: 'THINGS_QUERY',
    file: 'queries.ts',
    line: 2,
    body: 'query Things($limit: Int, $offset: Int, $orgRef: ID) { things(limit: $limit, offset: $offset, orgRef: $orgRef) { total } }',
  },
  { name: 'THING_FIELDS', file: 'queries.ts', line: 3, body: 'fragment ThingFields on Thing { id }' },
];

const declared = declaredVariables(DOCS, (d: { body: string }) => d.body);

function check(source: string) {
  const file = join(dir, `case-${Math.abs(hash(source))}.ts`);
  writeFileSync(file, source);
  return findCallerMismatches([file], declared, dir);
}
// Stable per-source filename without Date.now/Math.random.
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

describe('declaredVariables', () => {
  it('separates required from optional, and skips fragment-only consts', () => {
    expect([...declared.get('UPDATE_THING_MUTATION').required]).toEqual(['ref']);
    expect([...declared.get('UPDATE_THING_MUTATION').all].sort()).toEqual(['name', 'ref']);
    expect([...declared.get('THINGS_QUERY').required]).toEqual([]);
    expect(declared.has('THING_FIELDS')).toBe(false);
  });
});

describe('findCallerMismatches', () => {
  it('accepts a caller whose keys match', () => {
    const r = check('client.request(UPDATE_THING_MUTATION, { ref: "x", name: "n" });');
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(1);
  });

  // The exact hazard of the $variable sweep.
  it('rejects a stale key left behind by a rename, and suggests the new one', () => {
    const r = check('client.request(UPDATE_THING_MUTATION, { id: "x" });');
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].errors.join(' ')).toMatch(/passes "id".*did you mean "ref"/);
    expect(r.failures[0].errors.join(' ')).toMatch(/omits required variable "\$ref"/);
  });

  it('rejects an omitted required variable', () => {
    const r = check('client.request(UPDATE_THING_MUTATION, { name: "n" });');
    expect(r.failures[0].errors.join(' ')).toMatch(/omits required variable "\$ref"/);
  });

  it('accepts shorthand properties', () => {
    const r = check('const ref = "x"; client.request(UPDATE_THING_MUTATION, { ref });');
    expect(r.failures).toEqual([]);
  });

  it('resolves an object held in a local const and mutated afterwards', () => {
    const r = check(`
      const variables: Record<string, unknown> = { ref: "x" };
      variables.name = "n";
      client.request(UPDATE_THING_MUTATION, variables);
    `);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(1);
    expect(r.skipped).toEqual([]);
  });

  it('still catches a stale key inside a local const', () => {
    const r = check(`
      const variables: Record<string, unknown> = { id: "x" };
      client.request(UPDATE_THING_MUTATION, variables);
    `);
    expect(r.failures[0].errors.join(' ')).toMatch(/passes "id"/);
  });

  it('with a spread, still flags a visible bad key but not a possibly-supplied required one', () => {
    const r = check('client.request(UPDATE_THING_MUTATION, { id: "x", ...extra });');
    const joined = r.failures[0].errors.join(' ');
    expect(joined).toMatch(/passes "id"/);
    expect(joined).not.toMatch(/omits required/);
  });

  it('treats fetchAllItems limit/offset as injected, not missing', () => {
    const r = check('fetchAllItems(client, THINGS_QUERY, "things", { orgRef: "o" });');
    expect(r.failures).toEqual([]);
  });

  it('flags a bad key passed through fetchAllItems', () => {
    const r = check('fetchAllItems(client, THINGS_QUERY, "things", { orgId: "o" });');
    expect(r.failures[0].errors.join(' ')).toMatch(/passes "orgId"/);
  });

  it('skips an opaque variables argument instead of assuming it passes', () => {
    const r = check('client.request(UPDATE_THING_MUTATION, form.data);');
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(0);
    expect(r.skipped.join(' ')).toMatch(/not statically readable/);
  });

  it('skips an ambiguous name declared twice rather than risk a false report', () => {
    const r = check(`
      function a() { const variables = { ref: "x" }; return client.request(UPDATE_THING_MUTATION, variables); }
      function b() { const variables = { name: "n" }; return client.request(UPDATE_THING_MUTATION, variables); }
    `);
    expect(r.failures).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });

  // #690 review (Codex): an operation written inline never reaches the
  // `/* GraphQL */` extractor, so nothing validates it. Two such documents were
  // sitting in the portal with the pre-sweep `ref: $id` spelling while the gate
  // reported success.
  it('reports an inline document rather than skipping it', () => {
    const r = check("client.request('query AgentOrg($id: ID!) { agent(ref: $id) { organizationId } }', { id: 'x' });");
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].name).toBe('(inline document)');
    expect(r.failures[0].errors[0]).toMatch(/validated by nothing/);
  });

  it('reports an inline document written as a template literal', () => {
    const r = check('client.request(`mutation M($id: ID!) { doIt(ref: $id) }`, { id: "x" });');
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].name).toBe('(inline document)');
  });

  it('does not mistake an ordinary string argument for a document', () => {
    const r = check("client.request(notADocument, 'some-field');");
    expect(r.failures).toEqual([]);
  });

  // #690 review (Codex): a whole-file union of assignments accepted a key that
  // is only set AFTER the request, or inside a branch that may not run.
  it('ignores an assignment that happens after the request', () => {
    const r = check(`
      const vars: Record<string, unknown> = {};
      client.request(UPDATE_THING_MUTATION, vars);
      vars.ref = "x";
    `);
    expect(r.failures[0].errors.join(' ')).toMatch(/omits required variable "\$ref"/);
  });

  it('does not let a conditional assignment satisfy a required variable', () => {
    const r = check(`
      const vars: Record<string, unknown> = {};
      if (cond) vars.ref = "x";
      client.request(UPDATE_THING_MUTATION, vars);
    `);
    // Cannot prove it was set, so the required check is suppressed rather than
    // wrongly satisfied — and no false positive is raised either.
    expect(r.failures).toEqual([]);
  });

  it('still flags a stale key assigned conditionally', () => {
    const r = check(`
      const vars: Record<string, unknown> = {};
      if (cond) vars.id = "x";
      client.request(UPDATE_THING_MUTATION, vars);
    `);
    expect(r.failures[0].errors.join(' ')).toMatch(/passes "id"/);
  });

  it('accepts an unconditional assignment before the request', () => {
    const r = check(`
      const vars: Record<string, unknown> = {};
      vars.ref = "x";
      client.request(UPDATE_THING_MUTATION, vars);
    `);
    expect(r.failures).toEqual([]);
  });

  it('ignores request() calls for documents it does not know', () => {
    const r = check('client.request(SOME_OTHER_THING, { whatever: 1 });');
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(0);
  });

  // portal#696: the file pre-filter tested for the literal `.request(`, which
  // never matches an inline response-type annotation. That silently dropped 46
  // portal files — every endpoint and loader written this way — while the gate
  // still reported a healthy call-site count, and it is how the broken
  // completeAssetUpload caller survived from #182. Keep both spellings covered:
  // a checked one proves the file is parsed at all, a failing one proves the
  // check still bites there.
  it('checks a call site whose response type is annotated inline', () => {
    const r = check('client.request<{ updateThing: { id: string } }>(UPDATE_THING_MUTATION, { ref: "x" });');
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it('flags a stale key on a call site with an inline response type', () => {
    const r = check('client.request<{ updateThing: unknown }>(UPDATE_THING_MUTATION, { id: "x" });');
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].errors.join(' ')).toMatch(/did you mean "ref"/);
  });

  it('parses a chained client call with an inline response type', () => {
    const r = check(
      'await gqlClient(locals.token).request<{ things: unknown }>(THINGS_QUERY, { orgId: "o" });',
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].errors.join(' ')).toMatch(/passes "orgId".*"orgRef"/);
  });
});

/**
 * #868/#869 — the chooser branch.
 *
 * `client.request(nodeUpdateDocument(node, input), { input })` has no
 * identifier to look up, so without a branch for it every routed node write
 * falls to the opaque path and stops being variable-checked. Measured on the
 * real tree: removing the branch drops the checked call-site count 290 → 280.
 *
 * @copilot on PR #869 found the two spellings that branch did not cover — an
 * aliased import and a hoisted result — each of which counts as ROUTED for the
 * door gate while reading as an unknown document here. That combination is the
 * bad one: the write is correct and its variables are silently unchecked.
 */
describe('the node-write chooser (#868)', () => {
  const declared = new Map([
    ['UPDATE_NODE_MUTATION', { all: new Set(['input']), required: new Set(['input']), opName: 'UpdateNode' }],
  ]);

  function check(text: string) {
    const file = join(tmpdir(), `chooser-${Math.random().toString(36).slice(2)}.ts`);
    writeFileSync(file, text);
    try {
      return findCallerMismatches([file], declared, tmpdir());
    } finally {
      rmSync(file, { force: true });
    }
  }

  it.each([
    ['written inline', 'await client.request(nodeUpdateDocument(node, input), { input });'],
    [
      'imported under an alias',
      "import { nodeUpdateDocument as choose } from '$lib/server/nodeKindDoor';\n" +
        'await client.request(choose(node, input), { input });',
    ],
    [
      'hoisted into a local',
      'const mutation = nodeUpdateDocument(node, input);\nawait client.request(mutation, { input });',
    ],
    // @copilot: a destructured namespace binding is neither an import
    // specifier nor a property access at the call site.
    [
      'destructured off a namespace, then hoisted',
      "import * as door from '$lib/server/nodeKindDoor';\n" +
        'const { nodeUpdateDocument: choose } = door;\n' +
        'const mutation = choose(node, input);\n' +
        'await client.request(mutation, { input });',
    ],
  ])('checks a routed call %s', (_what, code) => {
    const { checked, failures } = check(code);
    expect(checked).toBe(1);
    expect(failures).toEqual([]);
  });

  // The direction that matters: a routed call whose variables are WRONG must
  // still be caught. A branch that resolves the document but stops checking
  // would pass the three cases above and this one is what tells them apart.
  it('still catches a wrong variable key behind the chooser', () => {
    const { failures } = check(
      'const mutation = nodeUpdateDocument(node, input);\n' +
        'await client.request(mutation, { wrong: value });',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].errors[0]).toContain('"wrong"');
  });
});


// #2609 — the keys inside an input-object variable.
const INPUT_SCHEMA = buildSchema(`
  input EdgeInput { targetRef: ID!, name: String }
  input WriteInput { ref: ID, memoryRef: ID, loc: String, tags: [String!], edges: [EdgeInput!], extra: EdgeInput }
  type Query { x: Int }
  type Mutation { write(input: WriteInput!): Int }
`);
const INPUT_DOCS = [
  { name: 'WRITE_MUTATION', file: 'q.ts', line: 1, body: 'mutation Write($input: WriteInput!) { write(input: $input) }' },
];
const inputDeclared = declaredVariables(INPUT_DOCS, (d: { body: string }) => d.body);
function checkInput(source: string) {
  const file = join(dir, `input-${Math.abs(hash(source))}.ts`);
  writeFileSync(file, source);
  return findInputKeyMismatches([file], inputDeclared, INPUT_SCHEMA, dir);
}

describe('findInputKeyMismatches (#2609)', () => {
  it('accepts an input whose keys the type declares, and counts it as read', () => {
    const r = checkInput('client.request(WRITE_MUTATION, { input: { memoryRef: "m", loc: "l", tags: [] } });');
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it('fails an old key in an object literal, with the renamed field as the hint', () => {
    const r = checkInput('client.request(WRITE_MUTATION, { input: { memoryId: "m", loc: "l" } });');
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].errors[0]).toMatch(/\$input passes "memoryId", which WriteInput does not declare — did you mean "memoryRef"\?/);
  });

  it('reads a const input passed by shorthand, and a stale id/ref pair', () => {
    const r = checkInput('const input = { id: "n", loc: "l" };\nclient.request(WRITE_MUTATION, { input });');
    expect(r.failures[0].errors[0]).toMatch(/passes "id".*did you mean "ref"/);
  });

  it('reads nested objects, `list.map(e => ({…}))` and array literals', () => {
    const mapped = checkInput('client.request(WRITE_MUTATION, { input: { ref: "n", edges: rows.map((e) => ({ targetId: e.t, name: null })) } });');
    expect(mapped.failures[0].errors[0]).toMatch(/\$input\.edges\[\] passes "targetId".*did you mean "targetRef"/);
    const literal = checkInput('client.request(WRITE_MUTATION, { input: { ref: "n", edges: [{ targetId: "a" }] } });');
    expect(literal.failures[0].errors[0]).toMatch(/\$input\.edges\[0\] passes "targetId"/);
    const nested = checkInput('client.request(WRITE_MUTATION, { input: { ref: "n", extra: { targetId: "a" } } });');
    expect(nested.failures[0].errors[0]).toMatch(/\$input\.extra passes "targetId"/);
    expect(checkInput('client.request(WRITE_MUTATION, { input: { ref: "n", edges: rows.map((e) => ({ targetRef: e.t })) } });').failures).toEqual([]);
  });

  it('resolves `input` by scope: one per function is not ambiguous, and a shadowing binding is never read as the outer one', () => {
    const two = checkInput(
      'async function a() { const input = { ref: "ok" }; await client.request(WRITE_MUTATION, { input }); }\n' +
        'async function b() { const input = { memoryId: "bad" }; await client.request(WRITE_MUTATION, { input }); }',
    );
    expect(two.checked).toBe(2);
    expect(two.failures).toHaveLength(1);
    expect(two.failures[0].line).toBe(2);
    const shadow = checkInput(
      'const input = { memoryId: "outer" };\n' +
        'for (const { input } of planned) { await client.request(WRITE_MUTATION, { input }); }',
    );
    expect(shadow.failures).toEqual([]);
    expect(shadow.skipped.join('\n')).toMatch(/\$input \(WriteInput not statically readable\)/);
  });

  it('applies `input.key = …` assignments that precede the call, and ignores one after it', () => {
    const before = checkInput('const input: any = { ref: "n" };\ninput.memoryId = "m";\nclient.request(WRITE_MUTATION, { input });');
    expect(before.failures[0].errors[0]).toMatch(/passes "memoryId"/);
    const after = checkInput('const input: any = { ref: "n" };\nclient.request(WRITE_MUTATION, { input });\ninput.memoryId = "m";');
    expect(after.failures).toEqual([]);
  });

  it('reads both branches of a conditional spread, and reports an unreadable spread as skipped', () => {
    expect(checkInput('client.request(WRITE_MUTATION, { input: { ref: "n", ...(x ? { memoryId: "m" } : {}) } });').failures).toHaveLength(1);
    const r = checkInput('client.request(WRITE_MUTATION, { input: { ref: "n", ...other } });');
    expect(r.failures).toEqual([]);
    expect(r.skipped.join('\n')).toMatch(/keys the gate cannot read/);
  });

  it('never passes an input it cannot read: a helper call is reported as skipped', () => {
    const r = checkInput('client.request(WRITE_MUTATION, { input: buildInput() });');
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(0);
    expect(r.skipped).toHaveLength(1);
  });
});
