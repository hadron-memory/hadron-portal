/**
 * #868 — one case per node-editing action, pinning the DOOR it uses.
 *
 * Every action here was refused against a governed node: the server's gate
 * reads the RESULTING state, so editing a task node's body still produces a
 * task node and the generic `updateNode` says no. None of these actions
 * mentions `isRunnable` or a door, which is why grepping the portal for the
 * signal found six sites and none of the broken ones
 * (`hrn:node:hadronmemory.com:dev:findings:a-gate-on-resulting-state-has-no-grep-signature`).
 *
 * The assertions name the mutation DOCUMENT, never the payload. The
 * `convertToTask` case passed for the whole life of the outage because it
 * pinned the payload shape: the action sent exactly the right input to exactly
 * the wrong operation, and a shape assertion cannot tell those apart.
 *
 * Each action is exercised against THREE nodes — ordinary, task, review — so
 * the test fails both on "did not route" and on "routes everything through the
 * task door". A one-node case passes on a chooser that ignores the node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODE_BY_ID_QUERY,
  NODE_QUERY,
  UPDATE_NODE_MUTATION,
  UPDATE_REVIEW_NODE_MUTATION,
  UPDATE_TASK_NODE_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

const base = {
  id: 'pk',
  memoryId: 'mem-1',
  loc: 'classify',
  name: 'Classify',
  tags: ['keep'],
  data: {},
  outgoingEdges: [],
  memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:mem-a' },
};

const KINDS = [
  ['an ordinary node', { role: null, isRunnable: null }, UPDATE_NODE_MUTATION],
  ['a task node', { role: null, isRunnable: true }, UPDATE_TASK_NODE_MUTATION],
  ['a review node', { role: 'review', isRunnable: null }, UPDATE_REVIEW_NODE_MUTATION],
] as const;

/**
 * Answer the node reads and record the writes. The mutation result shape does
 * not matter to any of these handlers — none of them reads it — so one stub
 * serves every door.
 */
function stubNode(signals: { role: string | null; isRunnable: boolean | null }) {
  const node = { ...base, ...signals };
  mockRequest.mockImplementation(async (query: unknown) => {
    if (query === NODE_BY_ID_QUERY || query === NODE_QUERY) return { node };
    return { updateNode: { id: 'pk' } };
  });
  return node;
}

/** Every mutation document the handler sent — i.e. every call that was not a read. */
function doorsUsed() {
  return mockRequest.mock.calls
    .map(([q]) => q)
    .filter((q) => q !== NODE_BY_ID_QUERY && q !== NODE_QUERY);
}

async function run(action: string, form: Record<string, string> = {}) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(form)) fd.set(key, value);
  return (actions as Record<string, (e: never) => Promise<unknown>>)[action]({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

/** The form payload each action needs to get past its own validation. */
const ACTIONS: Array<[string, Record<string, string>]> = [
  ['updateContent', { content: '# body' }],
  ['updateAbstract', { abstract: 'a summary' }],
  ['updateData', { data: '{"k":1}' }],
  ['updateFlow', { extractionRows: '[]', outputWriteTo: '', outputMode: 'replace' }],
  ['updateEdges', { edges: '[]' }],
  ['reorder', { updates: '[{"loc":"classify","seq":2}]' }],
];

describe.each(ACTIONS)('%s', (action, form) => {
  it.each(KINDS)('writes %s through its own door', async (_what, signals, door) => {
    stubNode(signals);
    await run(action, form);
    expect(doorsUsed()).toEqual([door]);
  });
});

describe('updateMeta', () => {
  const meta = (over: Record<string, string> = {}) => ({
    name: 'Classify',
    nodeType: 'info',
    description: '',
    alias: '',
    seq: '1',
    tags: 'keep',
    loc: 'classify',
    ...over,
  });

  it.each(KINDS)('writes %s through its own door when it touches no signal', async (_what, signals, door) => {
    stubNode(signals);
    await run('updateMeta', meta());
    expect(doorsUsed()).toEqual([door]);
  });

  // updateMeta is the ONE action here that can change a governance signal, so
  // it is the only one whose door is not simply the node's current kind.
  it('routes a write that PRODUCES a task through the task door', async () => {
    stubNode({ role: null, isRunnable: null });
    await run('updateMeta', meta({ isRunnable: 'on' }));
    expect(doorsUsed()).toEqual([UPDATE_TASK_NODE_MUTATION]);
  });

  /**
   * The direction #867 left broken, and the reason this PR is a fix.
   *
   * The server gates on BEFORE ∪ AFTER, so un-ticking Runnable on a task node
   * is still a task-door write — the refusal even changes voice for it ("This
   * write would REMOVE the marker that makes this a RUNNABLE node"). The old
   * routing read the submitted `isRunnable: false`, chose the generic door, and
   * was refused: converting a node TO a task worked and converting one BACK
   * did not.
   */
  it('routes a write that REMOVES the task marker through the task door', async () => {
    stubNode({ role: null, isRunnable: true });
    await run('updateMeta', meta()); // checkbox absent = unticked
    expect(doorsUsed()).toEqual([UPDATE_TASK_NODE_MUTATION]);
    expect(mockRequest.mock.calls.find(([q]) => q === UPDATE_TASK_NODE_MUTATION)![1].input)
      .toMatchObject({ isRunnable: false });
  });
});

describe('convertToTask', () => {
  it('goes through the task door', async () => {
    stubNode({ role: null, isRunnable: null });
    await run('convertToTask');
    expect(doorsUsed()).toEqual([UPDATE_TASK_NODE_MUTATION]);
  });

  // A fixed `UPDATE_TASK_NODE_MUTATION` here would send this write at a door
  // that also refuses it, and the user would be told to use a door that cannot
  // help. The chooser refuses first and says which combination has no door.
  it('refuses to convert a review node rather than pick a door that will also refuse', async () => {
    stubNode({ role: 'review', isRunnable: null });
    const result = (await run('convertToTask')) as { status?: number };
    expect(result.status).toBe(500);
    expect(doorsUsed()).toEqual([]);
  });
});

describe('reorder', () => {
  // The door is chosen PER SIBLING. A reorder routinely mixes kinds — one task
  // node among ordinary siblings is the common case, and it is what made a
  // whole reorder fail. Routing on the anchor node would send every sibling
  // through one door and be refused by the first that disagreed.
  it('picks a door per sibling, not from the anchor', async () => {
    const anchor = { ...base, id: 'anchor', loc: 'parent', role: null, isRunnable: null };
    const siblings: Record<string, typeof base & { role: string | null; isRunnable: boolean | null }> = {
      'a-plain': { ...base, loc: 'a-plain', role: null, isRunnable: null },
      'b-task': { ...base, loc: 'b-task', role: null, isRunnable: true },
      'c-review': { ...base, loc: 'c-review', role: 'review', isRunnable: null },
    };
    mockRequest.mockImplementation(async (query: unknown, vars: { ref?: string }) => {
      if (query === NODE_BY_ID_QUERY) return { node: anchor };
      if (query === NODE_QUERY) return { node: siblings[vars.ref as string] ?? null };
      return { updateNode: { id: 'pk' } };
    });

    await run('reorder', {
      updates: JSON.stringify([
        { loc: 'a-plain', seq: 1 },
        { loc: 'b-task', seq: 2 },
        { loc: 'c-review', seq: 3 },
      ]),
    });

    expect(doorsUsed()).toEqual([
      UPDATE_NODE_MUTATION,
      UPDATE_TASK_NODE_MUTATION,
      UPDATE_REVIEW_NODE_MUTATION,
    ]);
  });
});
