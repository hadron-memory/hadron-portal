/**
 * portal#1022 links half — the node view's Sign form MARKUP, pinned (Basil's
 * LOCAL P3 on #1860): the action-level tests in signatures.test.ts supply
 * formData themselves, so nothing failed when the hidden revision input, the
 * one-click disable or the error region broke. The "pinned to the text on
 * screen" claim rests on this markup, so it gets a client-lane pin: the page
 * has to mount for `use:enhance` to run, and the disable state lives in the
 * enhance round trip (the #782/#788 lifecycle gap).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { beginEnhanced } from '$lib/test/stubs/app-forms';
import { NODE_BY_ID_QUERY, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY, NODE_APPROVAL_QUERY, NODE_SIGNATURES_QUERY } from '$lib/server/queries';
import { COMMENT_THREADS_QUERY, NODE_COMMENT_SUMMARY_QUERY, SELF_MEMORY_ACCESS_QUERY } from '$lib/server/comments';
// Static imports: the page is large (see form-ids.client.test.ts).
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));
// The affordance rides on the loader's capability answer; the real helper
// fails closed (signing off) in jsdom, which would unmount the form entirely.
vi.mock('$lib/server/signing-capability', () => ({
  deploymentOffersSigning: vi.fn().mockResolvedValue(true),
}));

const NODE = {
  id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', revision: 4,
  nodeType: 'info', alias: null, description: null, content: 'body', abstract: null,
  tokens: null, tags: [], seq: null, data: null, properties: null, ownerRepo: null,
  isRunnable: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  outgoingEdges: [], incomingEdges: [],
  memory: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', appId: null },
};
const PARENT = {
  graph: { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a', name: 'Mem A', class: 'knowledge', isEncrypted: false },
  graphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'Foo', nodeType: 'info', tags: [] }],
  isConsumerMode: false,
  activeOrgId: 'org-1',
  user: { id: 'u1' },
};

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/memories/mem-A/nodes/leaf-pk', { id: 'mem-A', nodeId: 'leaf-pk' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY || doc === NODE_QUERY) return { node: NODE };
    if (doc === NODE_REVISIONS_PAGE_QUERY) return { nodeRevisionsPage: { items: [], total: 0, hasMore: false } };
    if (doc === NODE_SIGNATURES_QUERY) {
      return { node: { id: 'leaf-pk', revision: 4, signatureStatus: { state: 'NOT_APPLICABLE', integrityProblems: 0, signatures: [] } } };
    }
    if (doc === COMMENT_THREADS_QUERY) return { commentThreads: { total: 0, items: [] } };
    if (doc === NODE_COMMENT_SUMMARY_QUERY) {
      return { node: { id: 'leaf-pk', revision: 4, memory: { id: 'mem-A', urn: PARENT.graph.urn }, commentSummary: { openThreads: 0, resolvedThreads: 0, comments: 0, viewerOpenThreadId: null } } };
    }
    if (doc === SELF_MEMORY_ACCESS_QUERY) return { effectiveAccess: { canWrite: true, canManage: false } };
    return { memories: { items: [], total: 0 }, node: null, nodeRevisions: [] };
  });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

type PageProps = { data: Record<string, unknown>; form: Record<string, unknown> | null };

async function mountPage() {
  const loaded = (await load({
    params: { id: 'mem-A', nodeId: 'leaf-pk' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL('http://localhost/app/memories/mem-A/nodes/leaf-pk'),
    parent: vi.fn().mockResolvedValue(PARENT),
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<PageProps>({ data: { ...PARENT, ...loaded }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return { m, props };
}

describe('node page — Sign form markup (portal#1022)', () => {
  it('pins the request to the revision on screen: the hidden input carries node.revision', async () => {
    const { m } = await mountPage();
    const form = m.target.querySelector('form[action="?/requestSignature"]');
    expect(form).not.toBeNull();
    expect(form!.querySelector<HTMLInputElement>('input[type="hidden"][name="revision"]')!.value).toBe('4');
  });

  it('disables the button for the whole round trip, then re-enables', async () => {
    const { m } = await mountPage();
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/requestSignature"]')!;
    const button = form.querySelector<HTMLButtonElement>('[data-testid="request-signature"]')!;
    expect(button.disabled).toBe(false);
    // Submit: kit runs the enhance callback, which sets the one-click guard
    // BEFORE any request could mint a second signing request.
    const finish = await beginEnhanced(form);
    await tick();
    expect(button.disabled).toBe(true);
    // The server answers (a refusal here — same finally path as a redirect).
    await finish({ type: 'failure', status: 400, data: { requestSignatureError: 'Could not start a signing request.' } });
    await tick();
    expect(button.disabled).toBe(false);
  });

  it('announces the action error in the persistent region — mounted empty, filled by the answer', async () => {
    const { m, props } = await mountPage();
    const region = m.target.querySelector('[data-testid="signature-request-error"]')!;
    expect(region.getAttribute('role')).toBe('alert');
    expect(region.textContent).toBe(''); // mounted empty: a populated-on-mount region announces nothing
    props.form = { requestSignatureError: 'Your session has ended. Sign in again, then request the signature from the node page.' };
    await tick();
    expect(region.textContent).toContain('Your session has ended');
  });

  it('unmounts cleanly with the form present', async () => {
    const { m } = await mountPage();
    expect(m.target.querySelector('form[action="?/requestSignature"]')).not.toBeNull();
    m.unmount();
    expect(m.target.querySelector('form[action="?/requestSignature"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="signature-request-error"]')).toBeNull();
  });
});
