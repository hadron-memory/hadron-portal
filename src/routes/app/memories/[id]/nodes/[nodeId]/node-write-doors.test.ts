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
 * Each action is exercised against all FOUR node kinds — ordinary, task,
 * review, spec — so
 * the test fails both on "did not route" and on "routes everything through the
 * task door". A one-node case passes on a chooser that ignores the node.
 *
 * It covered three until @copilot pointed out that the register has four and
 * the missing one was `spec` — the weakest gate of the three governed kinds,
 * which is exactly the one nobody notices.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFingerprint } from '$lib/properties-source';
import {
  NODE_BY_ID_QUERY,
  NODE_DATA_READ_QUERY,
  NODE_QUERY,
  UPDATE_NODE_MUTATION,
  UPDATE_REVIEW_NODE_MUTATION,
  UPDATE_SPEC_NODE_MUTATION,
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
  // @copilot on PR #869: the register has three governed kinds and this table
  // covered two. `spec` is the weakest gate of the three (diligence, not
  // security), which is exactly why it is the one nobody would notice missing.
  ['a spec node', { role: 'spec', isRunnable: null }, UPDATE_SPEC_NODE_MUTATION],
] as const;

/**
 * Answer the node reads and record the writes. The mutation result shape does
 * not matter to any of these handlers — none of them reads it — so one stub
 * serves every door.
 */
function stubNode(signals: { role: string | null; isRunnable: boolean | null }) {
  const node = { ...base, ...signals };
  mockRequest.mockImplementation(async (query: unknown) => {
    if (query === NODE_BY_ID_QUERY || query === NODE_QUERY || query === NODE_DATA_READ_QUERY) return { node };
    return { updateNode: { id: 'pk' } };
  });
  return node;
}

/** Every mutation document the handler sent — i.e. every call that was not a read. */
function doorsUsed() {
  return mockRequest.mock.calls
    .map(([q]) => q)
    .filter((q) => q !== NODE_BY_ID_QUERY && q !== NODE_QUERY && q !== NODE_DATA_READ_QUERY);
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
  // #894: updateData refuses a save without the fingerprint of the value it
  // was opened on — the stub node's `data` is {}.
  ['updateData', { data: '{"k":1}', baseline: await jsonFingerprint({}) }],
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

describe('updateMeta — the move happens AFTER the door is settled', () => {
  /**
   * @copilot on PR #869. `updateMeta` moves the node first when its loc
   * changed, and the chooser can REFUSE — a node matching two governed kinds
   * has no door. A refusal raised after `moveNode` committed leaves the node
   * relocated with none of the edit applied, reported to the user as a 500:
   * the rename silently sticks and everything else silently does not.
   *
   * The door depends on the node's kind and not on its loc, so asking first
   * costs nothing. Pinned by asserting NO mutation of any sort was sent — a
   * test that only checked the door would pass on the broken ordering too,
   * since the door is equally absent either way.
   */
  it('does not move a node it is about to refuse to update', async () => {
    stubNode({ role: 'review', isRunnable: null });
    const result = (await run('updateMeta', {
      name: 'Classify',
      nodeType: 'info',
      description: '',
      alias: '',
      seq: '1',
      tags: 'keep',
      loc: 'somewhere:else',   // a MOVE, and
      isRunnable: 'on',        // a write with no door (review + task)
    })) as { status?: number };

    expect(result.status).toBe(500);
    // Neither the move nor the update — the only calls are the node reads.
    expect(doorsUsed()).toEqual([]);
    expect(mockRequest.mock.calls.every(([q]) => q === NODE_BY_ID_QUERY || q === NODE_QUERY)).toBe(true);
  });

  it('still moves when the write DOES have a door', async () => {
    stubNode({ role: null, isRunnable: null });
    await run('updateMeta', {
      name: 'Classify', nodeType: 'info', description: '', alias: '',
      seq: '1', tags: 'keep', loc: 'somewhere:else',
    });
    // The move is a non-read call ahead of the update, so both are present.
    expect(doorsUsed()).toHaveLength(2);
    expect(doorsUsed()[1]).toBe(UPDATE_NODE_MUTATION);
  });
});

describe('reorder — nothing is written until every door is settled', () => {
  /**
   * @copilot on PR #869. The loop used to fetch-and-write each sibling in turn,
   * so a later sibling the chooser REFUSES threw after earlier ones had already
   * had their `seq` changed: the tree ends up in an order the user never asked
   * for, under a 500 that says nothing about it.
   *
   * Both doors are resolved before the first write now. This does not make the
   * batch atomic — a SERVER refusal mid-loop still half-applies, and that wants
   * a batch mutation rather than a reordering here — but it removes the
   * half-apply this PR would otherwise have added.
   */
  it('writes nothing when a LATER sibling has no door', async () => {
    const siblings: Record<string, Record<string, unknown>> = {
      'a-plain': { ...base, loc: 'a-plain', role: null, isRunnable: null },
      'b-plain': { ...base, loc: 'b-plain', role: null, isRunnable: null },
      // No door exists for a runnable review: each door is exempt from its own
      // kind only, so both refuse it.
      'c-unwritable': { ...base, loc: 'c-unwritable', role: 'review', isRunnable: true },
    };
    mockRequest.mockImplementation(async (query: unknown, vars: { ref?: string }) => {
      if (query === NODE_BY_ID_QUERY) return { node: { ...base, role: null, isRunnable: null } };
      if (query === NODE_QUERY) return { node: siblings[vars.ref as string] ?? null };
      return { updateNode: { id: 'pk' } };
    });

    const result = (await run('reorder', {
      updates: JSON.stringify([
        { loc: 'a-plain', seq: 1 },
        { loc: 'b-plain', seq: 2 },
        { loc: 'c-unwritable', seq: 3 },
      ]),
    })) as { status?: number };

    expect(result.status).toBe(500);
    // The two writable siblings must NOT have been reordered. Asserting the
    // absence of every mutation, not just of the unwritable one's — a check on
    // the refused node alone passes on the write-as-you-go version too.
    expect(doorsUsed()).toEqual([]);
  });

  it('still writes all three when every door resolves', async () => {
    const siblings: Record<string, Record<string, unknown>> = {
      'a-plain': { ...base, loc: 'a-plain', role: null, isRunnable: null },
      'b-task': { ...base, loc: 'b-task', role: null, isRunnable: true },
      'c-review': { ...base, loc: 'c-review', role: 'review', isRunnable: null },
    };
    mockRequest.mockImplementation(async (query: unknown, vars: { ref?: string }) => {
      if (query === NODE_BY_ID_QUERY) return { node: { ...base, role: null, isRunnable: null } };
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
