/**
 * #992 slice C — the Mint dialog, mounted: it checks first (dry run), offers
 * the real run only when nothing blocks, lists blockers in the grid, stays
 * with the memory it was opened for, and never claims an unknown outcome.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { emptyRegions, regionHolding } from '$lib/test/liveRegionPin';
import MintDialog from './MintDialog.svelte';

const A = { id: 'mem-a', urn: 'hrn:mem:acme.com:specs-a' };
const B = { id: 'mem-b', urn: 'hrn:mem:acme.com:specs-b' };

const report = (over: Record<string, unknown> = {}) => ({
  dryRun: true, minted: false, mintedCount: 0, mintableCount: 3, blockers: [], openQuestionCount: 0, openFeedback: [], ...over,
});
// Microtask-only responses: deterministic, unlike a stream-backed Response (#994 CI).
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

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

function mountDialog(onminted = vi.fn()) {
  const props = reactiveProps<Record<string, unknown>>({ memory: A, open: true, onminted });
  const m = mountComponent(MintDialog as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return { ...m, props, onminted };
}
const q = (el: Element, id: string) => el.querySelector(`[data-testid="${id}"]`);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}

describe('MintDialog (#992 slice C)', () => {
  it('portal#1014: open discussions are listed as a warning and Mint is still offered (cor:dmo:110:07)', async () => {
    const urn = 'hrn:node:acme.com:specs-a:cor:a:1';
    fetchMock.mockResolvedValueOnce(reply(200, { report: report({ openFeedback: [{ urn, openThreads: 2 }] }) }));
    const { target } = mountDialog();
    await settle();
    const warning = q(target, 'mint-open-feedback')!;
    expect(warning.textContent).toContain('1 node has 2 open discussions. They don’t block minting');
    // A list of nodes is a DataTable (CLAUDE.md), with the count in its own column.
    expect(warning.querySelector('table')).not.toBeNull();
    expect([...warning.querySelectorAll('td')].map((td) => td.textContent?.trim())).toContain('2');
    expect(warning.querySelector(`a[href*="${urn}"]`)).not.toBeNull();
    // Never a gate: the real run is still offered.
    expect(q(target, 'mint-submit')).not.toBeNull();
  });

  it('portal#1014: no open discussions, no warning', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target } = mountDialog();
    await settle();
    expect(q(target, 'mint-open-feedback')).toBeNull();
  });

  it('opening runs a dry run, then minting runs the real one', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target, onminted } = mountDialog();
    await settle();
    expect(fetchMock.mock.calls[0][0]).toBe('/app/memories/mem-a/mint');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ dryRun: true });
    expect(q(target, 'mint-summary')!.textContent).toBe('3 nodes are ready to mint.');

    fetchMock.mockResolvedValueOnce(reply(200, { report: report({ dryRun: false, minted: true, mintedCount: 3 }) }));
    (q(target, 'mint-submit') as HTMLButtonElement).click();
    await settle();
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ dryRun: false });
    expect(q(target, 'mint-summary')!.textContent).toBe('Minted 3 nodes.');
    expect(q(target, 'mint-submit')).toBeNull();
    expect(onminted).toHaveBeenCalledTimes(1);
  });

  it('blockers are listed in the grid by node URN, and minting is not offered', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {
      report: report({ blockers: [
        { kind: 'NOT_APPROVED', loc: 'cor:x:010', rule: null, targetLoc: null },
        { kind: 'CITES_UNMINTED', loc: 'cor:x:020', rule: null, targetLoc: 'hrn:node:acme.com:other:y' },
      ] }),
    }));
    const { target } = mountDialog();
    await settle();
    expect(q(target, 'mint-summary')!.textContent).toBe('2 items block minting. Fix them, then try again.');
    expect(target.querySelector('table')).not.toBeNull();
    expect(target.textContent).toContain('Current content not approved');
    expect(target.textContent).toContain('current revision and approved content');
    const hrefs = [...target.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('hrn:node:acme.com:specs-a:cor:x:010'))).toBe(true);
    expect(q(target, 'mint-submit')).toBeNull();
    expect(q(target, 'mint-recheck')).not.toBeNull();
  });

  it('a real run refused as blocked shows the fresh list and says nothing was minted', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target, onminted } = mountDialog();
    await settle();
    fetchMock.mockResolvedValueOnce(reply(409, {
      error: 'Something now blocks minting, so nothing was minted. The list below is current.',
      report: report({ blockers: [{ kind: 'TAMPERED', loc: 'cor:x:030', rule: null, targetLoc: null }] }),
    }));
    (q(target, 'mint-submit') as HTMLButtonElement).click();
    await settle();
    expect(q(target, 'mint-error')!.textContent).toContain('nothing was minted');
    expect(target.textContent).toContain('re-approve it');
    expect(q(target, 'mint-submit')).toBeNull();
    expect(onminted).not.toHaveBeenCalled();
  });

  it('a real run with no answer is an unknown outcome', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target, onminted } = mountDialog();
    await settle();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    (q(target, 'mint-submit') as HTMLButtonElement).click();
    await settle();
    const text = q(target, 'mint-error')!.textContent!;
    expect(text).toContain('may or may not have gone through');
    expect(onminted).not.toHaveBeenCalled();
  });

  it('a late answer for memory A never renders in the dialog open on memory B', async () => {
    let answerA!: (r: Response) => void;
    let answerB!: (r: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((r) => (answerA = r)))
      .mockReturnValueOnce(new Promise<Response>((r) => (answerB = r)));
    const { target, props } = mountDialog(); // A's check is in flight
    props.memory = B; // the reader moves to memory B…
    flushSync();
    expect(q(target, 'mint-dialog')).toBeNull();
    props.open = true; // …and opens Mint there: B's check is in flight
    flushSync();
    expect(fetchMock.mock.calls[1][0]).toBe('/app/memories/mem-b/mint');

    answerA(reply(200, { report: report({ blockers: [{ kind: 'LINT', loc: 'cor:x:040', rule: 'tag-spec', targetLoc: null }] }) }));
    await settle();
    expect(q(target, 'mint-summary')).toBeNull(); // A's report never lands on B
    expect(target.textContent).not.toContain('tag-spec');

    answerB(reply(200, { report: report({ mintableCount: 1 }) }));
    await settle();
    expect(q(target, 'mint-summary')!.textContent).toBe('1 node is ready to mint.');
  });

  // Gene on #996, finding 1: a failed or unknown real run must not leave the
  // old "ready" report keeping Mint enabled under the warning.
  it.each([
    ['no answer', () => Promise.reject(new TypeError('network down'))],
    ['a 500', () => Promise.resolve(reply(500, { error: 'Minting couldn’t be confirmed. It may or may not have gone through.' }))],
    ['a 503 busy', () => Promise.resolve(reply(503, { error: 'This memory is being written to right now, so nothing was minted. Try again in a moment.' }))],
  ])('after %s from a real run, Mint is withdrawn and Check again offered', async (_label, answer) => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target } = mountDialog();
    await settle();
    expect(q(target, 'mint-submit')).not.toBeNull();
    fetchMock.mockImplementationOnce(answer);
    (q(target, 'mint-submit') as HTMLButtonElement).click();
    await settle();
    expect(q(target, 'mint-submit')).toBeNull();
    expect(q(target, 'mint-recheck')).not.toBeNull();
    expect(q(target, 'mint-summary')).toBeNull();
  });

  // Gene on #996, finding 2: a 200 with no usable report is not a mint.
  it('a 200 with no report after a real run is an unknown outcome, not a mint', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target, onminted } = mountDialog();
    await settle();
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    (q(target, 'mint-submit') as HTMLButtonElement).click();
    await settle();
    expect(onminted).not.toHaveBeenCalled();
    expect(q(target, 'mint-error')!.textContent).toContain('may or may not have gone through');
    expect(q(target, 'mint-submit')).toBeNull();
    expect(q(target, 'mint-recheck')).not.toBeNull();
  });

  it('a 200 with no report for the check says the check failed, and offers Check again', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: { dryRun: true } }));
    const { target } = mountDialog();
    await settle();
    expect(q(target, 'mint-error')!.textContent).toBe("Couldn't check this memory. Try again.");
    expect(q(target, 'mint-recheck')).not.toBeNull();
  });
});

// portal#2379 (slice of portal#2344): the summary lands in a status region that was already mounted and
// empty when the dialog opened, for the dry run and again for the real mint.
describe('summary live region', () => {
  it('the dry-run summary and then the minted summary land in the same, already-mounted status region', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { report: report() }));
    const { target } = mountDialog();
    const before = emptyRegions(target);
    expect(before.map((r) => r.getAttribute('role'))).toEqual(['status']);
    await settle();
    const region = regionHolding(target, '3 nodes are ready to mint.');
    expect(before).toContain(region);
    fetchMock.mockResolvedValueOnce(reply(200, { report: report({ dryRun: false, minted: true, mintedCount: 3 }) }));
    (q(target, 'mint-submit') as HTMLButtonElement).click();
    await settle();
    expect(regionHolding(target, 'Minted 3 nodes.')).toBe(region);
  });
});
