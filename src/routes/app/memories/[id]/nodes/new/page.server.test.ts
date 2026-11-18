import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_NODE_MUTATION, MEMORY_ROLE_RULES_QUERY, NODE_CHILDREN_QUERY } from '$lib/server/queries';
import { fakeFindNodesChildren, type FakeChildRow } from '$lib/test/fakeFindNodesChildren';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function loadEvent(opts: {
  parent?: string;
  loc?: string;
  isConsumerMode?: boolean;
  activeOrgId?: string | null;
  graphNodes?: Array<{ loc: string }>;
  graph?: { organizationId?: string | null };
} = {}) {
  const url = new URL('https://portal.test/app/memories/memory-1/nodes/new');
  if (opts.parent !== undefined) url.searchParams.set('parent', opts.parent);
  if (opts.loc !== undefined) url.searchParams.set('loc', opts.loc);

  return {
    url,
    params: { id: 'memory-1' },
    locals: { token: 'test-token' },
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: opts.isConsumerMode ?? false,
      activeOrgId: opts.activeOrgId ?? 'org-1',
      graphNodes: opts.graphNodes ?? [],
      // Default to an org-scoped memory so the consumer-bounce still applies
      // unless a test opts into an org-less (user-owned) memory.
      graph: opts.graph ?? { organizationId: 'org-1' },
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEvent(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: 'memory-1' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['default']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function runCreate(fields: Record<string, string>) {
  const { actions } = await importMod();
  try {
    return await actions.default(actionEvent(fields));
  } catch (e) {
    return e;
  }
}

describe('new node load()', () => {
  it('seeds the form and normalizes deep-link loc data without initial errors', async () => {
    serveSiblings([{ id: 's1', loc: 'parent:path:child' }, { id: 's2', loc: 'parent:path:child:deep' }, { id: 's3', loc: 'parent:other' }]);
    const { load } = await importMod();
    const event = loadEvent({
      parent: 'loc:parent/path',
      loc: 'urn:node:hadronmemory.com::dev::parent:child',
      graphNodes: [
        { loc: 'loc:parent/child' },
        { loc: 'hadronmemory.com:dev:other-node' },
      ],
    });

    const result = await load(event);

    expect((event.parent as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      parentLoc: 'parent:path',
      prefillLoc: 'parent:child',
      // portal#1656: the siblings under ?parent, read with childrenOf — not the
      // layout's graphNodes, which is no longer loaded (portal#1524).
      existingLocs: ['parent:path:child'],
      siblingsPartial: false,
    });
    expect((result as {
      form: { data: Record<string, string>; errors: Record<string, string[]> };
    }).form.data).toEqual({
      name: '',
      loc: 'parent:child',
      nodeType: 'info',
      description: '',
      abstract: '',
      tags: '',
      content: '',
      role: '',
      objectType: '',
      propertiesJson: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });

  it('redirects consumer-mode users away from an ORG-scoped memory', async () => {
    const { load } = await importMod();

    await expect(load(loadEvent({ isConsumerMode: true, activeOrgId: 'personal-org', graph: { organizationId: 'org-9' } })))
      .rejects
      .toMatchObject({ status: 303, location: '/app/orgs/personal-org/' });
  });

  it('#627: ALLOWS a consumer to author nodes in an org-less memory they own', async () => {
    const { load } = await importMod();
    // organizationId == null → user-owned; no bounce, the form loads.
    const result = await load(loadEvent({ isConsumerMode: true, activeOrgId: 'personal-org', graph: { organizationId: null } }));
    expect(result).toBeTruthy();
    expect(superFormFrom(result)).toBeTruthy();
  });
});

function serveSiblings(tree: FakeChildRow[], fail = false) {
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    if (doc !== NODE_CHILDREN_QUERY) throw new Error('unexpected document');
    if (fail) throw new Error('boom');
    return fakeFindNodesChildren(tree, 'memory-1')(vars);
  });
}

describe('new node load(): siblings for the default loc (portal#1656)', () => {
  type Loaded = { existingLocs: string[]; siblingsPartial: boolean };
  const run = async (parent: string) => (await (await importMod()).load(loadEvent({ parent }))) as unknown as Loaded;

  it('reads the siblings under ?parent with childrenOf (no locPrefix, no sort), one bounded page', async () => {
    serveSiblings([{ id: 'a', loc: 'p:a' }]);
    await run('p');
    const calls = mockRequest.mock.calls.filter(([d]) => d === NODE_CHILDREN_QUERY);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ memoryId: 'memory-1', childrenOf: 'p', limit: 21, offset: 0 });
  });

  it('suggests a loc that does not collide with siblings a and a-2', async () => {
    serveSiblings([{ id: '1', loc: 'p:a' }, { id: '2', loc: 'p:a-2' }]);
    const data = await run('p');
    expect(data.existingLocs).toEqual(['p:a', 'p:a-2']);
    expect(data.siblingsPartial).toBe(false);
    const { deriveDefaultLoc } = await import('$lib/create-node/derive-default-loc');
    expect(deriveDefaultLoc('A', 'p', data.existingLocs)).toBe('a-3');
  });

  it('with no ?parent, reads the top level', async () => {
    serveSiblings([{ id: '1', loc: 'a' }, { id: '2', loc: 'a:kid' }]);
    const data = await run('');
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ childrenOf: '' });
    expect(data.existingLocs).toEqual(['a']);
  });

  it('a capped sibling page is partial: the suggestion may collide', async () => {
    serveSiblings(Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, loc: `p:s${String(i).padStart(2, '0')}` })));
    const data = await run('p');
    expect(data.siblingsPartial).toBe(true);
  });

  it('exactly 20 siblings is a complete page', async () => {
    serveSiblings(Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, loc: `p:s${String(i).padStart(2, '0')}` })));
    const data = await run('p');
    expect(data.existingLocs).toHaveLength(20);
    expect(data.siblingsPartial).toBe(false);
  });

  it('a failed sibling read is partial, never "no siblings", and the form still loads', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    serveSiblings([], true);
    const data = await run('p');
    expect(data.existingLocs).toEqual([]);
    expect(data.siblingsPartial).toBe(true);
    expect(superFormFrom(data)).toBeTruthy();
  });
});

describe('new node create action', () => {
  it('rejects empty required fields before calling the API', async () => {
    const result = await runCreate({ name: '', loc: '', nodeType: 'info' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'name')).toBe('Name is required.');
    expect(fieldError(result, 'loc')).toBe('Loc is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects omitted required fields before calling the API', async () => {
    const result = await runCreate({ nodeType: 'info' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'name')).toBe('Name is required.');
    expect(fieldError(result, 'loc')).toBe('Loc is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects tampered node types before calling the API', async () => {
    const result = await runCreate({ name: 'Node', loc: 'node', nodeType: 'task' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'nodeType')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('creates a node with trimmed fields and normalized loc input', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'node-1' } });

    const result = await runCreate({
      name: '  Sort imports  ',
      loc: '  parent/sort-imports  ',
      nodeType: 'record',
      description: '  Short description  ',
      abstract: '  Summary  ',
      content: '  Body  ',
    });

    expect(result).toMatchObject({
      status: 303,
      location: '/app/memories/memory-1/nodes/node-1',
    });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_NODE_MUTATION, {
      input: {
        memoryId: 'memory-1',
        loc: 'parent:sort-imports',
        name: 'Sort imports',
        nodeType: 'record',
        description: 'Short description',
        abstract: 'Summary',
        content: 'Body',
        tags: [],
      },
    });
  });

  it('normalizes node URNs pasted into the loc field', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'node-2' } });

    await runCreate({
      name: 'Child',
      loc: 'urn:node:hadronmemory.com::dev::parent:child',
      nodeType: 'info',
    });

    expect(mockRequest).toHaveBeenCalledWith(CREATE_NODE_MUTATION, expect.objectContaining({
      input: expect.objectContaining({
        loc: 'parent:child',
        description: null,
        abstract: null,
        content: null,
      }),
    }));
  });

  // #588: structured storage — objectType + properties forwarding.
  it('forwards objectType and the parsed properties payload', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'node-3' } });

    await runCreate({
      name: 'Acme',
      loc: 'acme',
      nodeType: 'record',
      objectType: 'competitor',
      propertiesJson: '{"name": "Acme", "fundingUsd": 5}',
    });

    expect(mockRequest).toHaveBeenCalledWith(CREATE_NODE_MUTATION, expect.objectContaining({
      input: expect.objectContaining({
        objectType: 'competitor',
        properties: { name: 'Acme', fundingUsd: 5 },
      }),
    }));
  });

  it('#1166: forwards comma-separated tags, trimmed, dropping blanks and duplicates', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'node-5' } });

    await runCreate({ name: 'Node', loc: 'node', nodeType: 'info', tags: ' alpha, beta ,,alpha ' });

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, { input: { tags: string[] } }];
    expect(vars.input.tags).toEqual(['alpha', 'beta']);
  });

  it('omits objectType and properties when empty', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'node-4' } });

    await runCreate({ name: 'Node', loc: 'node', nodeType: 'info' });

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, { input: Record<string, unknown> }];
    expect(vars.input.objectType).toBeUndefined();
    expect(vars.input.properties).toBeUndefined();
  });

  it('maps schema violations (BAD_USER_INPUT) to a propertiesJson field error (#588)', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'properties.name: required field missing',
          extensions: { code: 'BAD_USER_INPUT' },
        }],
      },
    });

    const result = await runCreate({
      name: 'Acme',
      loc: 'acme',
      nodeType: 'record',
      objectType: 'competitor',
      propertiesJson: '{"fundingUsd": 5}',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'propertiesJson')).toBe('properties.name: required field missing');
  });

  it('maps loc conflicts to field errors', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'Node already exists',
          extensions: { code: 'NodeLocConflictError' },
        }],
      },
    });

    const result = await runCreate({ name: 'Node', loc: 'node', nodeType: 'info' });

    expect(result).toMatchObject({ status: 409 });
    expect(fieldError(result, 'loc')).toBe('A node with this loc already exists. Try a different name or loc.');
  });

  it('maps invalid loc errors to field errors', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'Invalid loc',
          extensions: { code: 'InvalidLocError' },
        }],
      },
    });

    const result = await runCreate({ name: 'Node', loc: 'urn:app:wrong-kind', nodeType: 'info' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'loc')).toBe('Loc segments may only contain letters, digits, hyphens, and underscores.');
  });

  it('returns non-field GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'Forbidden',
          extensions: { code: 'Forbidden' },
        }],
      },
    });

    const result = await runCreate({ name: 'Node', loc: 'node', nodeType: 'info' });

    expect(result).toMatchObject({ status: 403 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: "You don't have write access to this memory. Ask the memory's owner to add you as a writer.",
    });
  });
});

// portal#1142 S2b (hadron-server#2226; Xylon's gate 6329041498).
describe('create refused for an include tag', () => {
  const refusal = (code: string, tag: unknown = '<img src=x onerror=alert(1)>{{> t}}') => ({
    message: 'raw ClientError text with the query and PRIVATE-VARS',
    response: { errors: [{ message: 'Include {{> t}} names a node you cannot read.', extensions: { code, tag } }] },
  });

  it.each(['INCLUDE_TARGET_UNAVAILABLE', 'INVALID_INCLUDE', 'INCLUDE_CYCLE'])(
    '%s keeps the form as typed and says so with the server words, the tag and the draft sentence',
    async (code) => {
      mockRequest.mockRejectedValueOnce(refusal(code));
      const result = await runCreate({ name: 'Node', loc: 'node', nodeType: 'info', content: 'see {{> t}}' });
      expect(result).toMatchObject({ status: 400 });
      const form = superFormFrom(result);
      expect(form?.data).toMatchObject({ name: 'Node', content: 'see {{> t}}' });
      const message = form?.message as { type: string; text: string } | undefined;
      expect(message?.type).toBe('error');
      const text = String(message?.text);
      expect(text).toContain('Include {{> t}} names a node you cannot read.');
      expect(text).toContain('Tag: <img src=x onerror=alert(1)>{{> t}}.');
      expect(text).toContain('Your edit is still here.');
      expect(JSON.stringify(result)).not.toContain('PRIVATE-VARS');
    },
  );

  it('an unknown code keeps the existing message path, without the include text', async () => {
    mockRequest.mockRejectedValueOnce(refusal('SOMETHING_ELSE'));
    const result = await runCreate({ name: 'Node', loc: 'node', nodeType: 'info' });
    expect(String((superFormFrom(result)?.message as { text?: string } | undefined)?.text)).not.toContain('include tag');
  });
});


// #1670: choose a role when creating a node.
describe('new node role (#1670)', () => {
  const gqlRefusal = (code: string, extensions: Record<string, unknown>) => ({
    response: { errors: [{ message: 'refused by the server', extensions: { code, ...extensions } }] },
  });
  const base = { name: 'Node', loc: 'node', nodeType: 'info' };
  const sentInput = () => (mockRequest.mock.calls.find(([d]) => d === CREATE_NODE_MUTATION)![1] as { input: Record<string, unknown> }).input;

  it('an empty role field sends no role', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'n1' } });
    await runCreate({ ...base, role: '' });
    expect('role' in sentInput()).toBe(false);
  });
  it('a whitespace-only role field sends no role', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'n1' } });
    await runCreate({ ...base, role: '   ' });
    expect('role' in sentInput()).toBe(false);
  });
  it('a typed role is sent trimmed only: case and dots kept, no closed list', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'n1' } });
    await runCreate({ ...base, role: '  Spec.Feature  ' });
    expect(sentInput().role).toBe('Spec.Feature');
  });
  it('an invented role is sent as typed (suggestions never reject)', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'n1' } });
    await runCreate({ ...base, role: 'totally.made-up' });
    expect(sentInput().role).toBe('totally.made-up');
  });
  it('create never sends authoredWith, a task, a revision or any human/surface flag', async () => {
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'n1' } });
    await runCreate({ ...base, role: 'spec', authoredWith: 'HUMAN', human: 'true', task: 't', revision: '3', surface: 'portal' });
    expect(Object.keys(sentInput()).sort()).toEqual(['content', 'abstract', 'description', 'loc', 'memoryId', 'name', 'nodeType', 'objectType', 'properties', 'role', 'tags'].filter((k) => k in sentInput()).sort());
    for (const k of ['authoredWith', 'human', 'task', 'taskId', 'revision', 'expectedRevision', 'surface', 'trusted']) expect(k in sentInput()).toBe(false);
  });

  it('ROLE_NOT_DECLARED names the role and strict parent, and keeps everything typed', async () => {
    mockRequest.mockRejectedValueOnce(gqlRefusal('ROLE_NOT_DECLARED', { role: 'spec.nope', strictParent: 'spec' }));
    const result = await runCreate({ ...base, name: 'Keep me', description: 'kept', content: 'body', role: 'spec.nope' });
    const f = superFormFrom(result) as { data: Record<string, string>; message: { text: string } };
    expect(f.message.text).toContain('spec.nope');
    expect(f.message.text).toContain('spec');
    expect(f.message.text).toMatch(/declared sub-role|ask a manager/i);
    expect(f.data).toMatchObject({ name: 'Keep me', description: 'kept', content: 'body', role: 'spec.nope' });
  });
  it('ROLE_WRITER_LEVEL_REQUIRED shows the level copy and keeps the input', async () => {
    mockRequest.mockRejectedValueOnce(gqlRefusal('ROLE_WRITER_LEVEL_REQUIRED', { level: 'ADMIN', ruleRole: 'review', side: 'after' }));
    const result = await runCreate({ ...base, role: 'review' });
    const f = superFormFrom(result) as { data: Record<string, string>; message: { text: string } };
    expect(f.message.text).toContain('review');
    expect(f.message.text).toMatch(/admins or owners/);
    expect(f.data.role).toBe('review');
  });
  it('ROLE_WRITERS_UNSUPPORTED and ROLE_GOVERNED (create) keep the input with the server reason', async () => {
    mockRequest.mockRejectedValueOnce(gqlRefusal('ROLE_WRITERS_UNSUPPORTED', { level: 'OWNER', ruleRole: 'locked' }));
    const a = superFormFrom(await runCreate({ ...base, role: 'locked' })) as { data: Record<string, string>; message: { text: string } };
    expect(a.message.text).toMatch(/not supported yet/);
    expect(a.data.role).toBe('locked');
    mockRequest.mockRejectedValueOnce(gqlRefusal('ROLE_GOVERNED', { op: 'create', door: 'createSpecNode' }));
    const b = superFormFrom(await runCreate({ ...base, role: 'spec' })) as { data: Record<string, string>; message: { text: string } };
    expect(b.message.text).toContain('refused by the server');
    expect(b.message.text).toMatch(/create a specification node/);
    expect(b.data.role).toBe('spec');
  });
});

describe('new node load(): declared roles for managers (#1670)', () => {
  const rule = (role: string, over: Record<string, unknown> = {}) => ({
    role, enabled: true, writers: 'ALL', strictSubRoles: false, descriptionNode: null, descriptionNodeState: 'NONE', ...over,
  });
  const serve = (config: unknown, fail = false) => mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    if (doc === MEMORY_ROLE_RULES_QUERY) {
      if (fail) throw new Error('boom');
      return { memory: { id: 'memory-1', config } };
    }
    return fakeFindNodesChildren([], 'memory-1')(vars);
  });
  type Loaded = { roleRules: unknown };
  const run = async () => (await (await importMod()).load(loadEvent())) as unknown as Loaded;

  it('a manager gets every rule row, disabled included', async () => {
    serve({ rules: [rule('spec', { strictSubRoles: true }), rule('spec.feature', { enabled: false })] });
    const { roleRules } = await run();
    expect((roleRules as Array<{ role: string; enabled: boolean }>).map((r) => [r.role, r.enabled])).toEqual([['spec', true], ['spec.feature', false]]);
  });
  it('a non-manager (config null) gets no rule list and no config is invented', async () => {
    serve(null);
    expect((await run()).roleRules).toBeNull();
  });
  it('a failed rules read leaves the page working with no rule list', async () => {
    serve(null, true);
    expect((await run()).roleRules).toBeNull();
  });
  it('reads the rules with one narrow query for this memory', async () => {
    serve({ rules: [] });
    await run();
    const calls = mockRequest.mock.calls.filter(([d]) => d === MEMORY_ROLE_RULES_QUERY);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ ref: 'memory-1' });
  });
});
