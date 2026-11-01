/**
 * #1522 — the two ChatThread send forms must never share a Superforms id.
 *
 * `sendChatMessageSchema` backs exactly two mounted surfaces: this page's Chat
 * tab (loader `+page.server.ts`, action `?/sendChatMessage`) and the standalone
 * full-screen chat page (`./chat`, action `?/sendMessage`). Both defaulted to
 * the schema's SHAPE-hash id (`1qyjqon`), so a handoff between the two pages —
 * the "Full-screen chat" / "View node details" hop — could register the id
 * twice against one page-store value: superforms' duplicate-id registry is
 * keyed by `get(page)` and removed only in `onDestroy`, and the incoming
 * page's `superForm()` runs before the outgoing page's teardown. The browser
 * console then logs "Duplicate form id's found" and, per
 * `hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids`,
 * both forms would receive the same action data.
 *
 * The fix is the boot-prompt pattern
 * (`hrn:node:hadronmemory.com:hadron-portal:findings:superforms-teardown-clears-result-guards`):
 * an id scoped to SURFACE **and node** (`sendChatMessage:<nodeId>` here,
 * `sendMessage:<nodeId>` on the chat page — the same `bootStart:<agentId>`
 * shape the agent page uses), set in each surface's loader and its action so
 * the client form, the action result and the no-JS post all agree; ChatThread
 * keyed by that id so a same-route node A→B hop cannot leave a live form
 * holding A's id against B's results; and ChatThread seeding from the page's
 * submitted action data only when that data's id is its own. This file mounts
 * the real page for a platform team chat and an agent chat, checks the ids,
 * and drives the page-to-page handoff that produced the warning on main (red
 * before the fix, green after).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
  captureUnhandledRejections,
  mountComponent,
  tick,
  type Mounted,
} from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { beginEnhanced } from '$lib/test/stubs/app-forms';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import {
  LEGACY_THREAD_PROBE_QUERY,
  NODES_BY_LOC_PREFIX_QUERY,
  NODE_BY_ID_QUERY,
  NODE_QUERY,
  NODE_REVISIONS_QUERY,
} from '$lib/server/queries';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';
// Static imports: the page is large, and importing it inside a test spent the
// test's whole timeout under full-suite load (same note as form-ids.client).
import Page from './+page.svelte';
import ChatPage from './chat/+page.svelte';
import { actions as nodeActions, load as loadNode } from './+page.server';
import { actions as chatActions, load as loadChat } from './chat/+page.server';
import HandoffHost from './chat-handoff.harness.svelte';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
  serverBaseUrl: () => 'http://localhost:4000',
}));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

// portal#1433: the node reads that replaced the layout's graphNodes.
const reads = serveMemoryReads([], { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' });

const MEM = 'mem-1';

/** A platform team chat: nodeType 'chat', the team-chat loc, an App memory. */
function teamChatNode() {
  return {
    id: 'chat-pk', memoryId: MEM, memory: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'notes', appId: 'app-1' },
    loc: 'chats:team', name: 'team', revision: null,
    nodeType: 'chat', alias: null, description: null, content: null, abstract: null,
    tokens: null, tags: [] as string[], seq: null, data: null, properties: null, ownerRepo: null, isRunnable: false,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    outgoingEdges: [], incomingEdges: [],
  };
}

/** An agent chat in an App memory: nodeType 'chat' at a non-team loc. */
function agentChatNode() {
  const node = teamChatNode();
  return { ...node, id: 'agent-chat-pk', loc: 'agents:ada:conversations:c1', name: 'Ada conversation' };
}

const PARENT = {
  graph: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'notes', class: 'org', isEncrypted: false },
  graphNodes: [{ id: 'chat-pk', memoryId: MEM, loc: 'chats:team', name: 'team', nodeType: 'chat', tags: [] }],
  isConsumerMode: false, activeOrgId: 'org-1', user: { id: 'u1' },
};

const warnings: string[] = [];
let warnSpy: { mockRestore: () => void } | undefined;

beforeEach(() => {
  mockRequest.mockReset();
  warnings.length = 0;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  setStubPage(`http://localhost/app/memories/${MEM}/nodes/chat-pk`, { id: MEM, nodeId: 'chat-pk' });
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  warnSpy?.mockRestore();
});

function serveNode(...nodes: Array<ReturnType<typeof teamChatNode>>) {
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    { const served = reads(doc, vars); if (served !== undefined) return served; }
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) {
      const ref = String(vars?.ref ?? vars?.id ?? '');
      const served = nodes.find((n) => n.id === ref);
      // No silent fallback: every loader here fetches by a node PK it was
      // handed, so a miss means the loader queried by an unexpected ref, and
      // serving nodes[0] anyway would keep the id legs green against the
      // wrong node. Fail loudly instead (the mock's bug, not the product's).
      if (!served) throw new Error(`serveNode: no served node matches ref ${JSON.stringify(ref)} — the loader fetched by an unexpected ref`);
      return { node: served };
    }
    if (doc === NODE_REVISIONS_QUERY) return { nodeRevisions: [] };
    if (doc === LEGACY_THREAD_PROBE_QUERY) {
      return { findNodes: { total: 1, hits: [{ node: { loc: `${nodes[0].loc}:messages:001-ada`, nodeType: 'message' } }] } };
    }
    if (doc === NODES_BY_LOC_PREFIX_QUERY) return { findNodes: { hits: [] } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
}

async function loadNodePage(node: ReturnType<typeof teamChatNode>, url: URL) {
  return (await loadNode({
    params: { id: MEM, nodeId: node.id },
    locals: { token: 'tok' },
    url,
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
}

async function mountPage(node: ReturnType<typeof teamChatNode>, url: URL) {
  serveNode(node);
  const loaded = await loadNodePage(node, url);
  expect(loaded.isChat).toBe(true);
  // #1320's guard, on this loader's full form set: the explicit chat id joins
  // eleven other form ids without collision.
  expectDistinctFormIds(loaded, 12);
  const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  flushSync();
  await tick();
  return { ...m, props, loaded };
}

const duplicateWarnings = () => warnings.filter((w) => w.includes('Duplicate form id'));

describe('#1522 chat send form identity', () => {
  it('team chat: explicit node-scoped id, distinct from every other form, no duplicate warning', async () => {
    const { target, loaded } = await mountPage(teamChatNode(), new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`));
    expect((loaded.sendChatMessageForm as { id: string }).id).toBe('sendChatMessage:chat-pk');
    expect(target.querySelector('form[action="?/sendChatMessage"]')).not.toBeNull();
    expect(duplicateWarnings()).toEqual([]);
  });

  it('agent chat: the id carries that node, not the team chat\'s', async () => {
    const { loaded } = await mountPage(agentChatNode(), new URL(`http://localhost/app/memories/${MEM}/nodes/agent-chat-pk`));
    expect((loaded.sendChatMessageForm as { id: string }).id).toBe('sendChatMessage:agent-chat-pk');
    expect(duplicateWarnings()).toEqual([]);
  });

  it('the send action validates with the same id (a failed post stays this form\'s)', async () => {
    serveNode(teamChatNode());
    const fd = new FormData();
    fd.set('_kind', 'sendChatMessage');
    fd.set('content', '');
    const r = (await nodeActions.sendChatMessage({
      request: { formData: async () => fd },
      params: { id: MEM, nodeId: 'chat-pk' },
      locals: { token: 'tok' },
    } as never)) as { status: number; data: { form: { id: string } } };
    expect(r.status).toBe(400);
    expect(r.data.form.id).toBe('sendChatMessage:chat-pk');
  });

  it('standalone chat page: its own surface id in loader and action', async () => {
    serveNode(teamChatNode());
    const loaded = (await loadChat({
      params: { id: MEM, nodeId: 'chat-pk' },
      locals: { token: 'tok' },
      url: new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk/chat`),
      parent: vi.fn().mockResolvedValue(PARENT),
    } as never)) as { form: { id: string } };
    expect(loaded.form.id).toBe('sendMessage:chat-pk');
    const fd = new FormData();
    fd.set('_kind', 'sendChatMessage');
    fd.set('content', '');
    const r = (await chatActions.sendMessage({
      request: { formData: async () => fd },
      params: { id: MEM, nodeId: 'chat-pk' },
      locals: { token: 'tok' },
    } as never)) as { status: number; data: { form: { id: string } } };
    expect(r.status).toBe(400);
    expect(r.data.form.id).toBe('sendMessage:chat-pk');
  });

  // The red-first carrier: on main both surfaces shared the schema's shape
  // hash, and the handoff window logged "Duplicate form id's found: 1qyjqon".
  // The harness's 'overlap' phase is that window made deterministic — see its
  // docblock for why kit's own ordering is not reproduced here.
  it('handoff between the node page and the standalone chat page stays warning-free', async () => {
    serveNode(teamChatNode());
    const nodeData = await loadNodePage(teamChatNode(), new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`));
    const chatData = (await loadChat({
      params: { id: MEM, nodeId: 'chat-pk' },
      locals: { token: 'tok' },
      url: new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk/chat`),
      parent: vi.fn().mockResolvedValue(PARENT),
    } as never)) as Record<string, unknown>;

    const host = mountComponent(HandoffHost as never, {
      a: { comp: Page, props: { data: { ...PARENT, ...nodeData } } },
      b: { comp: ChatPage, props: { data: { ...PARENT, ...chatData } } },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(host);
    const instance = host.instance as { setPhase(p: 'a' | 'overlap' | 'b'): void };
    await tick();
    flushSync();
    await tick();
    expect(duplicateWarnings()).toEqual([]);

    // node page -> full-screen chat: both pages live under one page value,
    // then the node page is gone. Then back again — each direction passes
    // through the same window. Every phase teardown is a window where a
    // torn-down page's async lifecycle could throw into the void, so the
    // loop runs under rejection capture: a post-teardown crash fails the
    // leg instead of disappearing.
    const phaseRejections = await captureUnhandledRejections(async () => {
      for (const p of ['overlap', 'b', 'overlap', 'a'] as const) {
        instance.setPhase(p);
        await tick();
        flushSync();
        await tick();
        expect(duplicateWarnings(), `phase=${p}`).toEqual([]);
      }
    });
    expect(phaseRejections).toEqual([]);
  });

  // hrn:node:hadronmemory.com:hadron-portal:findings:superforms-teardown-clears-result-guards (Chip's P2): a delayed
  // action result is applied globally by id, and the first live form with the
  // posted id consumes it. A send submitted on the node page that resolves
  // after the reader opened the full-screen chat must not report success (or
  // failure) through the chat page's composer. On main the shared id made the
  // chat page's form consume the node page's late result; the node-scoped ids
  // leave that result with no live form on the new surface.
  it('a late send result does not surface on the other page after the handoff', async () => {
    serveNode(teamChatNode());
    const nodeData = await loadNodePage(teamChatNode(), new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`));
    const chatData = (await loadChat({
      params: { id: MEM, nodeId: 'chat-pk' },
      locals: { token: 'tok' },
      url: new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk/chat`),
      parent: vi.fn().mockResolvedValue(PARENT),
    } as never)) as Record<string, unknown>;

    const host = mountComponent(HandoffHost as never, {
      a: { comp: Page, props: { data: { ...PARENT, ...nodeData } } },
      b: { comp: ChatPage, props: { data: { ...PARENT, ...chatData } } },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(host);
    const instance = host.instance as { setPhase(p: 'a' | 'overlap' | 'b'): void; setForm(s: 'a' | 'b', f: unknown): void };
    await tick();
    flushSync();
    await tick();

    // The submit leaves while the node page is showing…
    const composer = host.target.querySelector<HTMLFormElement>('form[action="?/sendChatMessage"]');
    expect(composer).not.toBeNull();
    const deliver = await beginEnhanced(composer!);

    // …and resolves after the full-screen chat page has fully replaced it.
    instance.setPhase('b');
    await tick();
    flushSync();
    await tick();

    // The ActionResult the real action returns on a late GraphQL failure:
    // `message(form, { type: 'error', … }, { status: 500 })` — a failure
    // whose data carries THIS form, under the id it was posted with.
    // Delivered under rejection capture: the result handler belongs to a
    // form kit has torn down, and a crash in that window must fail the leg
    // rather than vanish as an unhandled rejection.
    const postedId = (nodeData.sendChatMessageForm as { id: string }).id;
    const lateResult = {
      type: 'failure' as const,
      status: 500,
      data: {
        form: {
          id: postedId,
          valid: false,
          posted: true,
          errors: {},
          data: { _kind: 'sendChatMessage', content: 'hello' },
          message: { type: 'error', text: 'Failed to send message' },
        },
      },
    };
    const deliverRejections = await captureUnhandledRejections(async () => {
      await deliver(lateResult);
      // Kit's applyAction put that result on the surviving page too.
      instance.setForm('b', lateResult.data);
      await tick();
      flushSync();
      await tick();
    });
    expect(deliverRejections).toEqual([]);

    expect(host.target.querySelector('[role="alert"]')).toBeNull();
    expect(host.target.textContent).not.toContain('Failed to send message');
    expect(duplicateWarnings()).toEqual([]);
  });

  // The same finding's same-route shape: ChatThread persists across a node
  // A→B hop on this route (it is deliberately NOT keyed by node), so on main a
  // late result posted on A's composer could banner — or seed the draft of —
  // B's composer, one id shared by every node's chat. The fix keys ChatThread
  // by the node-scoped id (fresh form per node) and seeds from the page's
  // submitted data only when its id matches. Modelled with the same host: 'a'
  // is node A's page, 'b' is the SAME route at node B.
  it('a late send result on node A neither banners nor seeds node B\'s composer', async () => {
    const nodeA = teamChatNode();
    // A postable chat at a DIFFERENT node: the `team-chat` tag routes it
    // through the legacy post target (a second node at the canonical
    // `chats:team` loc does not exist — that loc IS the identity), and
    // nodeType 'chat' keeps it on the chat surface.
    const nodeB = { ...teamChatNode(), id: 'chat-pk-2', loc: 'chats:team-2', name: 'team 2', tags: ['team-chat'] };
    serveNode(nodeA, nodeB);
    const aData = await loadNodePage(nodeA, new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`));
    // Same route, same memory, a different chat node: the data swap a
    // same-route navigation performs without remounting the page component.
    const bData = await loadNodePage(nodeB, new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk-2`));

    const host = mountComponent(HandoffHost as never, {
      a: { comp: Page, props: { data: { ...PARENT, ...aData } } },
      b: { comp: Page, props: { data: { ...PARENT, ...bData } } },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(host);
    const instance = host.instance as { setPhase(p: 'a' | 'overlap' | 'b'): void; setForm(s: 'a' | 'b', f: unknown): void };
    const target = host.target;
    await tick();
    flushSync();
    await tick();

    const composer = target.querySelector<HTMLFormElement>('form[action="?/sendChatMessage"]');
    expect(composer).not.toBeNull();
    const deliver = await beginEnhanced(composer!);

    instance.setPhase('b');
    await tick();
    flushSync();
    await tick();

    const postedId = (aData.sendChatMessageForm as { id: string }).id;
    const lateResult = {
      type: 'failure' as const,
      status: 500,
      data: {
        form: {
          id: postedId,
          valid: false,
          posted: true,
          errors: { content: ['Message cannot be empty'] },
          data: { _kind: 'sendChatMessage', content: 'written for A' },
          message: { type: 'error', text: 'Failed to send message' },
        },
      },
    };
    // The deliver runs against A's torn-down form; both this window and the
    // remount window below run under rejection capture so a post-teardown
    // crash in either fails the leg instead of vanishing.
    const deliverRejections = await captureUnhandledRejections(async () => {
      await deliver(lateResult);
      instance.setForm('b', lateResult.data);
      await tick();
      flushSync();
      await tick();
    });
    expect(deliverRejections).toEqual([]);

    // B's composer neither banners A's failure…
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.textContent).not.toContain('Failed to send message');
    // …nor takes A's half-written text as its draft. On main the shared id
    // let B's live form consume A's result wholesale.
    const bComposer = target.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
    expect(bComposer).not.toBeNull();
    expect(bComposer!.value).not.toBe('written for A');
    expect(duplicateWarnings()).toEqual([]);

    // …and a page that mounts WHILE that old action data is still on the
    // page (one more navigation before anything clears it) must not SEED
    // from it either — the `form`-prop exposure r1 pinned. On main the
    // remounted ChatThread reseeds A's draft and message; with the id filter
    // it starts from its own loader data.
    const remountRejections = await captureUnhandledRejections(async () => {
      instance.setPhase('a');
      await tick();
      instance.setPhase('b');
      instance.setForm('b', lateResult.data);
      await tick();
      flushSync();
      await tick();
    });
    expect(remountRejections).toEqual([]);
    expect(target.querySelector('[role="alert"]')).toBeNull();
    const fresh = target.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
    expect(fresh).not.toBeNull();
    expect(fresh!.value).not.toBe('written for A');
  });

  // The same seed path, positive direction: B's OWN submitted failure (id
  // matching B's live form) must still banner and keep B's draft — the r1
  // pin's other half, proving the id filter did not fence out legitimate
  // results.
  it('the same-surface result with the live form\'s own id still reports', async () => {
    serveNode(teamChatNode());
    const nodeData = await loadNodePage(teamChatNode(), new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`));
    const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...nodeData }, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick();
    flushSync();
    await tick();

    const composer = m.target.querySelector<HTMLFormElement>('form[action="?/sendChatMessage"]');
    expect(composer).not.toBeNull();
    const area = m.target.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
    expect(area).not.toBeNull();
    // A real send: text typed, submit out, server refuses it.
    area!.value = 'a message the server will refuse';
    area!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    flushSync();

    const deliver = await beginEnhanced(composer!);
    const postedId = (nodeData.sendChatMessageForm as { id: string }).id;
    const result = {
      type: 'failure' as const,
      status: 500,
      data: {
        form: {
          id: postedId,
          valid: false,
          posted: true,
          errors: {},
          data: { _kind: 'sendChatMessage', content: 'a message the server will refuse' },
          message: { type: 'error', text: 'Failed to send message' },
        },
      },
    };
    await deliver(result);
    // Kit's applyAction: the page's own `form` prop becomes the result data.
    props.form = result.data;
    await tick();
    flushSync();
    await tick();

    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain('Failed to send message');
  });

  // #957, pinned for THIS composer now that the seed is id-gated: a SUCCESSFUL
  // send's action data holds the text just sent, and seeding from it would
  // re-fill the composer on every remount (a tab switch away and back — the
  // page's action data survives it) and make it the value `resetForm` restores,
  // so the reader's next Send posts a duplicate. Only FAILED submissions seed
  // (the draft worth keeping); a success starts the composer clean. On main
  // this leg re-fills the composer with the sent text.
  it('a successful send does not re-fill the composer when the tab remounts', async () => {
    serveNode(teamChatNode());
    const nodeData = await loadNodePage(teamChatNode(), new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`));
    const props = reactiveProps<Record<string, unknown>>({ data: { ...PARENT, ...nodeData }, form: null });
    const first = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(first);
    await tick();
    flushSync();
    await tick();

    const composer = first.target.querySelector<HTMLFormElement>('form[action="?/sendChatMessage"]');
    expect(composer).not.toBeNull();
    const area = first.target.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
    expect(area).not.toBeNull();
    area!.value = 'sent already';
    area!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    flushSync();

    const deliver = await beginEnhanced(composer!);
    const result = {
      type: 'success' as const,
      status: 200,
      data: {
        form: {
          id: (nodeData.sendChatMessageForm as { id: string }).id,
          valid: true,
          posted: true,
          errors: {},
          data: { _kind: 'sendChatMessage', content: 'sent already' },
          message: { type: 'success', text: 'Message sent.' },
        },
      },
    };
    await deliver(result);
    // The tab switch: ChatThread unmounts (tab away) while the page's action
    // data stays, then mounts again (tab back) with it still on `form`.
    first.unmount();
    mounted.splice(mounted.indexOf(first), 1);
    props.form = result.data;
    const second = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(second);
    await tick();
    flushSync();
    await tick();

    const reSeeded = second.target.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
    expect(reSeeded).not.toBeNull();
    expect(reSeeded!.value).toBe('');
    expect(second.target.querySelector('[role="alert"]')).toBeNull();
  });
});
