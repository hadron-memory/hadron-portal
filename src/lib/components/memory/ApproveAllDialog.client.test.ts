/**
 * #992 — the Approve all dialog, mounted. Gene on #994: the memory layout is
 * reused across memories, so a result must stay with the memory it was for,
 * and an answer that never arrived must not claim nothing was approved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import ApproveAllDialog from './ApproveAllDialog.svelte';

const A = { id: 'mem-a', urn: 'hrn:mem:acme.com:specs-a' };
const B = { id: 'mem-b', urn: 'hrn:mem:acme.com:specs-b' };
const RESULT = { approvedCount: 2, alreadyApprovedCount: 1, skippedPlaceholders: ['cor:x:010'], openFeedback: [] as Array<{ urn: string; openThreads: number }> };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

function mountDialog(onapproved = vi.fn()) {
  const props = reactiveProps<Record<string, unknown>>({ memory: A, open: true, onapproved });
  const m = mountComponent(ApproveAllDialog as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return { ...m, props, onapproved };
}
const q = (el: Element, id: string) => el.querySelector(`[data-testid="${id}"]`);
// A response whose body resolves in a microtask. A real `Response` reads its
// body through a stream, whose timing varies with load: CI ran out of the
// fixed ticks below before the body arrived (#994). And the late-answer test
// asserts an ABSENCE, which an under-waited test would pass for the wrong
// reason, so the timing has to be deterministic rather than just longer.
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const ok = (body: unknown) => reply(200, body);

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

describe('ApproveAllDialog (#992)', () => {
  it('portal#1014: nodes with open discussions are listed with the result, as a warning', async () => {
    const urn = 'hrn:node:acme.com:specs-a:cor:x:020';
    fetchMock.mockResolvedValue(ok({ result: { ...RESULT, openFeedback: [{ urn, openThreads: 3 }] } }));
    const { target } = mountDialog();
    (q(target, 'approve-all-submit') as HTMLButtonElement).click();
    await settle();
    const warning = q(target, 'approve-all-open-feedback')!;
    expect(warning.textContent).toContain('1 node in this memory has an open discussion');
    expect(warning.querySelector(`a[href*="${urn}"]`)).not.toBeNull();
  });

  it('portal#1014: before approving, the dialog points at where open discussions show', () => {
    const { target } = mountDialog();
    expect(q(target, 'approve-all-feedback-hint')!.textContent).toContain('marked in the node list');
    expect(q(target, 'approve-all-result')).toBeNull();
  });

  it('portal#1014: no open discussions, no warning', async () => {
    fetchMock.mockResolvedValue(ok({ result: RESULT }));
    const { target } = mountDialog();
    (q(target, 'approve-all-submit') as HTMLButtonElement).click();
    await settle();
    expect(q(target, 'approve-all-result')).not.toBeNull();
    expect(q(target, 'approve-all-open-feedback')).toBeNull();
  });

  it('posts for its memory and shows the counts, with placeholders as that memory’s node URNs', async () => {
    fetchMock.mockResolvedValue(ok({ result: RESULT }));
    const { target, onapproved } = mountDialog();
    (q(target, 'approve-all-submit') as HTMLButtonElement).click();
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/app/memories/mem-a/approve-all', { method: 'POST' });
    expect(q(target, 'approve-all-result')!.textContent).toContain('Approved 2 nodes. 1 were already approved.');
    const hrefs = [...target.querySelectorAll('a')].map((el) => el.getAttribute('href'));
    expect(hrefs.some((h) => h?.includes('hrn:node:acme.com:specs-a:cor:x:010'))).toBe(true);
    // A list of nodes is a DataTable, not a <ul> (@codex on #994).
    expect(target.querySelector('table')).not.toBeNull();
    expect(target.querySelector('[aria-label="Search the placeholders Approve all skipped"]')).not.toBeNull();
    expect(target.querySelector('ul')).toBeNull();
    expect(onapproved).toHaveBeenCalledTimes(1);
  });

  it('a late answer for memory A never renders under memory B', async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (answer = r)));
    const { target, props, onapproved } = mountDialog();
    (q(target, 'approve-all-submit') as HTMLButtonElement).click();
    flushSync();

    props.memory = B; // the reader navigates to another memory mid-request
    flushSync();
    expect(q(target, 'approve-all-dialog')).toBeNull();

    answer(ok({ result: RESULT }));
    await settle();
    props.open = true; // and opens Approve all on B
    flushSync();
    expect(q(target, 'approve-all-result')).toBeNull();
    expect(target.textContent).not.toContain('specs-a');
    expect(onapproved).not.toHaveBeenCalled();
  });

  it('no usable answer is an unknown outcome, not "nothing was approved"', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    const { target, onapproved } = mountDialog();
    (q(target, 'approve-all-submit') as HTMLButtonElement).click();
    await settle();
    const text = q(target, 'approve-all-error')!.textContent!;
    expect(text).toContain('may or may not have gone through');
    expect(text).not.toContain('nothing was approved');
    expect(onapproved).not.toHaveBeenCalled();
  });

  it('a typed refusal shows the server endpoint’s fixed copy', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: 'fixed refusal copy' }));
    const { target } = mountDialog();
    (q(target, 'approve-all-submit') as HTMLButtonElement).click();
    await settle();
    expect(q(target, 'approve-all-error')!.textContent).toBe('fixed refusal copy');
  });
});
