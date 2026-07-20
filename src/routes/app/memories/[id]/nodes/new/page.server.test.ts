import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_NODE_MUTATION } from '$lib/server/queries';

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
} = {}) {
  const url = new URL('https://portal.test/app/memories/memory-1/nodes/new');
  if (opts.parent !== undefined) url.searchParams.set('parent', opts.parent);
  if (opts.loc !== undefined) url.searchParams.set('loc', opts.loc);

  return {
    url,
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: opts.isConsumerMode ?? false,
      activeOrgId: opts.activeOrgId ?? 'org-1',
      graphNodes: opts.graphNodes ?? [],
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
      existingLocs: ['parent:child', 'other-node'],
    });
    expect((result as {
      form: { data: Record<string, string>; errors: Record<string, string[]> };
    }).form.data).toEqual({
      name: '',
      loc: 'parent:child',
      nodeType: 'info',
      description: '',
      abstract: '',
      content: '',
      objectType: '',
      propertiesJson: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });

  it('redirects consumer-mode users away', async () => {
    const { load } = await importMod();

    await expect(load(loadEvent({ isConsumerMode: true, activeOrgId: 'personal-org' })))
      .rejects
      .toMatchObject({ status: 303, location: '/app/orgs/personal-org/' });
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
