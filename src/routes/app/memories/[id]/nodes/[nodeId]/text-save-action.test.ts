/**
 * #927 — the inline Content and Abstract saves carry the revision the editor
 * opened on, and a conflict keeps the user's draft.
 *
 * The fake server below honours `expectedRevision` the way hadron-server#937
 * specifies it: a mismatch refuses with NODE_WRITE_CONFLICT and writes nothing;
 * an omitted guard is last-write-wins. The stale-editor scenario is run in BOTH
 * directions — the guarded save is refused, and the same stale save without the
 * guard would have overwritten — so the test cannot pass on a fake that never
 * enforces anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY, UPDATE_NODE_MUTATION } from '$lib/server/queries';
import { parseExpectedRevision } from '$lib/node-revision';
import { TextDraft } from '$lib/text-draft.svelte';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));
// The draft's module imports the page-side submit helper; the node lane has no
// `$app/*`, and nothing here submits through it.
vi.mock('$app/forms', () => ({ deserialize: vi.fn() }));

/** One stored node, advanced a revision per successful write. */
let stored: { id: string; memoryId: string; loc: string; tags: string[]; content: string | null; abstract: string | null; revision: number };

function gqlError(code: string, message = code) {
  return Object.assign(new Error(message), { response: { errors: [{ message, extensions: { code } }] } });
}

beforeEach(() => {
  mockRequest.mockReset();
  stored = { id: 'pk', memoryId: 'mem-1', loc: 'notes', tags: ['keep'], content: 'v1', abstract: 'a1', revision: 1 };
  mockRequest.mockImplementation(async (query: unknown, vars: { input?: Record<string, unknown> }) => {
    if (query === NODE_BY_ID_QUERY) return { node: { ...stored, role: null, isRunnable: null } };
    const input = vars.input!;
    if (input.expectedRevision !== undefined && input.expectedRevision !== stored.revision) {
      throw gqlError('NODE_WRITE_CONFLICT', 'The node changed since it was read.');
    }
    if ('content' in input) stored.content = input.content as string;
    if ('abstract' in input) stored.abstract = input.abstract as string;
    stored.revision++;
    return { updateNode: { id: stored.id } };
  });
});

async function save(action: 'updateContent' | 'updateAbstract', form: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return (actions as Record<string, (e: never) => Promise<unknown>>)[action]({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

/** The editor as the page holds it: seeded from the node when Source opens. */
function openEditor(field: 'content' | 'abstract') {
  const draft = new TextDraft();
  draft.reseed({ id: stored.id, value: stored[field], revision: stored.revision });
  draft.ensureSeeded();
  return draft;
}

const writes = () => mockRequest.mock.calls.filter(([q]) => q !== NODE_BY_ID_QUERY);

describe.each([
  ['updateContent', 'content'],
  ['updateAbstract', 'abstract'],
] as const)('%s', (action, field) => {
  it('sends the revision the editor opened on as expectedRevision', async () => {
    const out = await save(action, { [field]: 'new', expectedRevision: '1' });
    expect(out).toEqual({ [`${field}Saved`]: true });
    const [, vars] = writes()[0] as [unknown, { input: Record<string, unknown> }];
    expect(vars.input.expectedRevision).toBe(1);
    expect(vars.input[field]).toBe('new');
    expect(stored[field]).toBe('new');
  });

  it('stale editor: A opens, B saves, A saves — A is refused with a conflict and keeps its draft', async () => {
    const editorA = openEditor(field);
    editorA.text = 'A edit';

    const editorB = openEditor(field);
    editorB.text = 'B edit';
    expect(await save(action, { [field]: editorB.text, expectedRevision: String(editorB.baseRevision) })).toEqual({
      [`${field}Saved`]: true,
    });

    const out = (await save(action, { [field]: editorA.text, expectedRevision: String(editorA.baseRevision) })) as {
      status: number;
      data: Record<string, unknown>;
    };
    expect(out.status).toBe(409);
    expect(out.data).toEqual({ [`${field}Failed`]: { code: 'changed', detail: null } });
    // B's save survives, and A's draft is untouched and still based on revision 1.
    expect(stored[field]).toBe('B edit');
    expect(editorA.text).toBe('A edit');
    expect(editorA.baseRevision).toBe(1);
    expect(editorA.isBehind(stored[field])).toBe(true);
  });

  it('…and the same stale save WITHOUT the guard would have overwritten B (the fake enforces nothing it is not sent)', async () => {
    const editorA = openEditor(field);
    await save(action, { [field]: 'B edit', expectedRevision: '1' });
    // The pre-#927 request: the whole buffer, no precondition.
    const { gqlClient } = await import('$lib/server/api');
    await gqlClient('tok').request(UPDATE_NODE_MUTATION, { input: { memoryId: 'mem-1', loc: 'notes', [field]: editorA.text } });
    expect(stored[field]).toBe(editorA.text);
  });

  it('refuses a save that carries no revision, and writes nothing', async () => {
    for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '2147483648']) {
      mockRequest.mockClear();
      const form: Record<string, string> = { [field]: 'x' };
      if (bad !== undefined) form.expectedRevision = bad;
      const out = (await save(action, form)) as { status: number; data: Record<string, unknown> };
      expect(out.status).toBe(400);
      expect(out.data).toEqual({ [`${field}Failed`]: { code: 'no-baseline', detail: null } });
      expect(mockRequest).not.toHaveBeenCalled();
    }
  });

  it('reports any other failure as `failed` with the server\'s words', async () => {
    mockRequest.mockImplementation(async (query: unknown) => {
      if (query === NODE_BY_ID_QUERY) return { node: { ...stored, role: null, isRunnable: null } };
      throw gqlError('INTERNAL_SERVER_ERROR', 'database unavailable');
    });
    const out = (await save(action, { [field]: 'x', expectedRevision: '1' })) as { status: number; data: Record<string, unknown> };
    expect(out.status).toBe(500);
    expect(out.data).toEqual({ [`${field}Failed`]: { code: 'failed', detail: 'database unavailable' } });
  });

  it('a node that is gone is `not-found`', async () => {
    mockRequest.mockImplementation(async () => ({ node: null }));
    const out = (await save(action, { [field]: 'x', expectedRevision: '1' })) as { status: number; data: Record<string, unknown> };
    expect(out.status).toBe(404);
    expect(out.data).toEqual({ [`${field}Failed`]: { code: 'not-found', detail: null } });
  });
});

describe('parseExpectedRevision', () => {
  it('accepts a positive 32-bit integer and nothing else', () => {
    expect(parseExpectedRevision('1')).toBe(1);
    expect(parseExpectedRevision('2147483647')).toBe(2_147_483_647);
    for (const bad of [null, '', '0', '01', '-1', '1.5', '1e3', ' 1', '2147483648', '99999999999']) {
      expect(parseExpectedRevision(bad)).toBeNull();
    }
    expect(parseExpectedRevision(new File([], 'x'))).toBeNull();
  });
});
