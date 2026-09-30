/**
 * #927 — the inline Content and Abstract saves carry the revision the editor
 * opened on, and a conflict keeps the user's draft.
 *
 * The fake server below honours `expectedRevision`: a mismatch refuses the
 * proposed edit with NODE_WRITE_CONFLICT; an omitted guard is last-write-wins.
 * The stale-editor scenario runs in BOTH directions so the test cannot pass on
 * a fake that never enforces the guard. A separate raw-drift scenario models
 * hadron-server#1458: reconciliation can advance the stored revision before
 * refusing the proposed edit, so a conflict does not mean nothing was written.
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
let reconcileBeforeNextGuardedSave: (() => void) | null;

function gqlError(code: string, message = code) {
  return Object.assign(new Error(message), { response: { errors: [{ message, extensions: { code } }] } });
}

beforeEach(() => {
  mockRequest.mockReset();
  stored = { id: 'pk', memoryId: 'mem-1', loc: 'notes', tags: ['keep'], content: 'v1', abstract: 'a1', revision: 1 };
  reconcileBeforeNextGuardedSave = null;
  mockRequest.mockImplementation(async (query: unknown, vars: { input?: Record<string, unknown> }) => {
    if (query === NODE_BY_ID_QUERY) return { node: { ...stored, role: null, isRunnable: null } };
    const input = vars.input!;
    if (input.expectedRevision !== undefined && reconcileBeforeNextGuardedSave) {
      const reconcile = reconcileBeforeNextGuardedSave;
      reconcileBeforeNextGuardedSave = null;
      reconcile();
      stored.revision++;
      throw gqlError('NODE_WRITE_CONFLICT', 'The node changed since it was read.');
    }
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

async function refreshEditor(editor: TextDraft, field: 'content' | 'abstract') {
  const { gqlClient } = await import('$lib/server/api');
  const { node } = (await gqlClient('tok').request(NODE_BY_ID_QUERY, { ref: stored.id })) as { node: typeof stored };
  editor.sync({ id: node.id, value: node[field], revision: node.revision });
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
    // The server's words ride along: the conflict is worded from them unless a
    // reload shows this field moved.
    expect(out.data).toEqual({ [`${field}Failed`]: { code: 'changed', detail: 'The node changed since it was read.' } });
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

  it('raw drift: a refused edit can advance revision, then a fresh read permits a second user save if this field is unchanged', async () => {
    const editor = openEditor(field);
    editor.text = 'my edit';
    reconcileBeforeNextGuardedSave = () => {
      stored.tags = [...stored.tags, 'reconciled'];
    };

    const first = (await save(action, { [field]: editor.text, expectedRevision: String(editor.baseRevision) })) as {
      status: number;
      data: Record<string, unknown>;
    };
    expect(first.status).toBe(409);
    expect(first.data).toEqual({ [`${field}Failed`]: { code: 'changed', detail: 'The node changed since it was read.' } });
    expect(writes()).toHaveLength(1);
    expect((writes()[0][1] as { input: { expectedRevision: number } }).input.expectedRevision).toBe(1);
    expect(stored[field]).toBe(field === 'content' ? 'v1' : 'a1'); // proposed text was not applied
    expect(stored.tags).toEqual(['keep', 'reconciled']); // reconciliation did write
    expect(stored.revision).toBe(2);

    await refreshEditor(editor, field);
    expect(editor.text).toBe('my edit');
    expect(editor.dirty).toBe(true);
    expect(editor.baseRevision).toBe(2);
    expect(editor.isBehind(stored[field])).toBe(false);
    expect(writes()).toHaveLength(1); // the read does not retry the edit

    expect(await save(action, { [field]: editor.text, expectedRevision: String(editor.baseRevision) })).toEqual({
      [`${field}Saved`]: true,
    });
    expect(writes()).toHaveLength(2);
    expect((writes()[1][1] as { input: { expectedRevision: number } }).input.expectedRevision).toBe(2);
    expect(stored[field]).toBe('my edit');
    expect(stored.revision).toBe(3);
  });

  it('raw drift in the edited field keeps the dirty draft and its stale revision after refresh', async () => {
    const editor = openEditor(field);
    editor.text = 'my edit';
    reconcileBeforeNextGuardedSave = () => {
      stored[field] = 'reconciled text';
    };

    const first = (await save(action, { [field]: editor.text, expectedRevision: String(editor.baseRevision) })) as {
      status: number;
      data: Record<string, unknown>;
    };
    expect(first.status).toBe(409);
    expect(first.data).toEqual({ [`${field}Failed`]: { code: 'changed', detail: 'The node changed since it was read.' } });
    expect(stored[field]).toBe('reconciled text');
    expect(stored.revision).toBe(2);

    await refreshEditor(editor, field);
    expect(editor.text).toBe('my edit');
    expect(editor.dirty).toBe(true);
    expect(editor.baseRevision).toBe(1);
    expect(editor.isBehind(stored[field])).toBe(true);
    expect(writes()).toHaveLength(1); // no silent overwrite or automatic retry
  });

  it('raw drift refuses the edit even when the supplied token equals the reconciliation revision', async () => {
    reconcileBeforeNextGuardedSave = () => {
      stored.tags = [...stored.tags, 'reconciled'];
    };

    const out = (await save(action, { [field]: 'my edit', expectedRevision: '2' })) as {
      status: number;
      data: Record<string, unknown>;
    };
    expect(out.status).toBe(409);
    expect(out.data).toEqual({ [`${field}Failed`]: { code: 'changed', detail: 'The node changed since it was read.' } });
    expect(stored.revision).toBe(2);
    expect(stored[field]).toBe(field === 'content' ? 'v1' : 'a1');
    expect(writes()).toHaveLength(1);
  });

  it('refuses a save that carries no revision before making a server request', async () => {
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
