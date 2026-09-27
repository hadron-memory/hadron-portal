/**
 * #914 — authorship + advisory validation are streamed by their OWN reads, so
 * a failure there costs only that display. `contentValidation` is non-null on
 * the server: folded into the node or history read, one resolver error would
 * null the node (or the whole revision list) and take the page down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, visit } from 'graphql';
import {
  NODE_BY_ID_QUERY,
  NODE_PROVENANCE_QUERY,
  NODE_QUERY,
  NODE_REVISION_PROVENANCE_QUERY,
  NODE_REVISION_QUERY,
  NODE_REVISIONS_PROVENANCE_QUERY,
  NODE_REVISIONS_QUERY,
} from '$lib/server/queries';
import type { NodeProvenance, ProvenanceResult } from '$lib/node-provenance';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: null,
  tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
  isRunnable: null, createdAt: '', updatedAt: '',
  outgoingEdges: [], incomingEdges: [],
};
const PROV: NodeProvenance = {
  id: 'leaf-pk',
  authorship: { kind: 'TASK', taskRef: 'hrn:node:acme.com:ops:tasks:t', taskRevision: 2, human: null, authoredAt: '2026-09-27T10:00:00Z' },
  contentValidation: { state: 'UNVALIDATED', latestReport: null },
};

/** Answer by document, so the test doesn't depend on the loader's call order. */
function serve(overrides: Map<string, (vars: Record<string, unknown>) => unknown>) {
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    const o = overrides.get(doc);
    if (o) return o(vars);
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    return { memories: { items: [], total: 0 } };
  });
}

function loadEvent() {
  return {
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo' }],
      graph: { urn: 'hrn:mem:acme.com:mem-a' },
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as never;
}

type Loaded = {
  node: unknown;
  provenance: Promise<ProvenanceResult<NodeProvenance>>;
  revisionProvenance: Promise<ProvenanceResult<NodeProvenance[]>>;
};
async function runNodeLoad(): Promise<Loaded> {
  const { load } = await import('./+page.server');
  return (await load(loadEvent())) as unknown as Loaded;
}

describe('node page — provenance is its own streamed read', () => {
  it('reads the node\'s provenance by id, and its History rows\' with the history limit', async () => {
    const hist = { id: 'r1', revNo: 3, authorship: null, contentValidation: { state: 'STALE', latestReport: null } };
    serve(new Map<string, (v: Record<string, unknown>) => unknown>([
      [NODE_PROVENANCE_QUERY, () => ({ node: PROV })],
      [NODE_REVISIONS_PROVENANCE_QUERY, () => ({ nodeRevisions: [hist] })],
    ]));
    const data = await runNodeLoad();
    expect(await data.provenance).toEqual({ ok: true, value: PROV });
    expect(await data.revisionProvenance).toEqual({ ok: true, value: [hist] });
    const nodeCall = mockRequest.mock.calls.find(([d]) => d === NODE_PROVENANCE_QUERY);
    expect(nodeCall?.[1]).toEqual({ ref: 'leaf-pk' });
    const histCall = mockRequest.mock.calls.find(([d]) => d === NODE_REVISIONS_PROVENANCE_QUERY);
    const listCall = mockRequest.mock.calls.find(([d]) => d === NODE_REVISIONS_QUERY);
    expect(histCall?.[1]).toEqual(listCall?.[1]); // same node, same limit: every row is covered
  });

  it('a provenance failure leaves the node and its history loading, and reports ok:false', async () => {
    serve(new Map<string, (v: Record<string, unknown>) => unknown>([
      [NODE_PROVENANCE_QUERY, () => { throw new Error('validation resolver boom'); }],
      [NODE_REVISIONS_PROVENANCE_QUERY, () => { throw new Error('history provenance boom'); }],
    ]));
    const data = await runNodeLoad();
    expect(data.node).toMatchObject({ id: 'leaf-pk' });
    expect(await data.provenance).toEqual({ ok: false });
    expect(await data.revisionProvenance).toEqual({ ok: false });
  });

  it('a null node from the provenance read is ok:false, not an empty claim', async () => {
    serve(new Map<string, (v: Record<string, unknown>) => unknown>([
      [NODE_PROVENANCE_QUERY, () => ({ node: null })],
    ]));
    const data = await runNodeLoad();
    expect(await data.provenance).toEqual({ ok: false });
  });
});

describe('revision view — the snapshot\'s own provenance, streamed', () => {
  function revEvent() {
    return { params: { id: 'mem-A', nodeId: 'leaf-pk', revisionId: 'r1' }, locals: { token: 'tok' } } as never;
  }
  const REV = { id: 'r1', revNo: 3, nodeId: 'leaf-pk', loc: 'foo', name: 'foo', tags: [], editedBy: null, createdAt: '' };

  it('the revision loads when its provenance read fails', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === NODE_REVISION_QUERY) return { nodeRevision: REV };
      if (doc === NODE_REVISION_PROVENANCE_QUERY) throw new Error('boom');
      throw new Error(`unexpected ${doc.slice(0, 40)}`);
    });
    const { load } = await import('./revisions/[revisionId]/+page.server');
    const data = (await load(revEvent())) as unknown as { revision: unknown; provenance: Promise<unknown> };
    expect(data.revision).toEqual(REV);
    expect(await data.provenance).toEqual({ ok: false });
  });

  it('reads provenance for THIS revision id', async () => {
    const p = { id: 'r1', revNo: 3, authorship: null, contentValidation: { state: 'UNVALIDATED', latestReport: null } };
    mockRequest.mockImplementation(async (doc: string) =>
      doc === NODE_REVISION_QUERY ? { nodeRevision: REV } : { nodeRevision: p },
    );
    const { load } = await import('./revisions/[revisionId]/+page.server');
    const data = (await load(revEvent())) as unknown as { provenance: Promise<unknown> };
    expect(await data.provenance).toEqual({ ok: true, value: p });
    expect(mockRequest.mock.calls.find(([d]) => d === NODE_REVISION_PROVENANCE_QUERY)?.[1]).toEqual({ revisionId: 'r1' });
  });
});

/** Every field name selected anywhere in a document, read from its AST (not its text, which has comments). */
function selectedFields(doc: string): Set<string> {
  const names = new Set<string>();
  visit(parse(doc), { Field: (f) => void names.add(f.name.value) });
  return names;
}

describe('the shared reads never select provenance', () => {
  for (const [name, doc] of Object.entries({ NODE_QUERY, NODE_BY_ID_QUERY, NODE_REVISIONS_QUERY, NODE_REVISION_QUERY })) {
    it(`${name} selects neither contentValidation nor authorship`, () => {
      const fields = selectedFields(doc);
      expect(fields.has('contentValidation')).toBe(false);
      expect(fields.has('authorship')).toBe(false);
    });
  }

  it('the guard can see a selection when there is one (positive control)', () => {
    expect(selectedFields(NODE_PROVENANCE_QUERY).has('contentValidation')).toBe(true);
    expect(selectedFields(NODE_REVISIONS_PROVENANCE_QUERY).has('authorship')).toBe(true);
    // A mention in a comment is not a selection.
    expect(selectedFields('# contentValidation\nquery Q { node(ref: "x") { id } }').has('contentValidation')).toBe(false);
  });
});
