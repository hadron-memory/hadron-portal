/**
 * portal#1665 Ask 5-6 — the served-record view. A record names what a bind/run/chat was GIVEN
 * (ids, revisions, hashes, recorded variables); it carries no text. States are honest by
 * construction: an empty answer renders nothing, a failure never reads as empty, null lint
 * is "unavailable" not "none", and a reused host never shows the previous subject's records.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import ServedPrompt from './ServedPrompt.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { captureUnhandledRejections, mountComponent, tick, wait } from '$lib/test/mountComponent';

const record = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1', kind: 'BIND', ordinal: 1, pointerLevel: 'APP_AGENT',
  servedAt: '2026-11-04T10:00:00.000Z', servedRevSeq: 7, provenanceRevSeq: 7, pruned: false,
  compiledContentHash: 'hash-abc', variables: { worker: 'wk' },
  node: { urn: 'hrn:node:x:y:boot', name: 'Boot prompt' },
  provenance: { items: [{ revSeq: 3, hash: 'ph-1', pruned: false }, { revSeq: 2, hash: 'ph-2', pruned: true }], total: 2, offset: 0 },
  lint: { items: [], total: 0, nextCursor: null },
  ...over,
});
const page = (items: unknown[], total = items.length, offset = 0) => ({ items, total, offset });
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

/** Response.json() resumes over several microtasks; wait on the clock, then flush effects. */
const settle = async () => { await wait(15); flushSync(); };
const mounted: Array<{ unmount: () => void }> = [];
function show(fetchImpl: typeof fetch, props: Record<string, unknown> = {}) {
  const m = mountComponent(ServedPrompt as never, { source: 'worker', refId: 'w1', fetchImpl, ...props } as never);
  mounted.push(m);
  return m;
}
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const text = (m: { target: HTMLElement }) => m.target.textContent ?? '';

describe('honest states', () => {
  it('an empty page renders NOTHING: no section, no "no records" text', async () => {
    const m = show(() => ok(page([])));
    await settle();
    expect(m.target.querySelector('[data-testid="served-prompt"]')).toBeNull();
    expect(text(m).trim()).toBe('');
  });

  it('a failed read says it could not load, and is never shown as empty', async () => {
    const m = show(() => Promise.resolve(new Response('{}', { status: 502 })));
    await settle();
    expect(m.target.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t load the served prompt.");
    expect(m.target.querySelector('[data-testid="served-prompt"]')).toBeNull();
  });

  it('a network error is the same failure state', async () => {
    const m = show(() => Promise.reject(new Error('offline')));
    await settle();
    expect(m.target.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('null lint => "Warnings unavailable", distinct from an empty list', async () => {
    const m = show(() => ok(page([record({ lint: null })])));
    await settle();
    expect(text(m)).toContain('Warnings unavailable');
    const n = show(() => ok(page([record()])));
    await settle();
    expect(text(n)).not.toContain('Warnings unavailable');
  });
});

describe('what a record shows', () => {
  it('pointer level, revision, hash, when, recorded values, name with URN chip, labelled CURRENT warnings', async () => {
    const m = show(() => ok(page([record({ lint: { items: [{ kind: 'BROKEN_INCLUDE', position: 4, pinnedRevision: null, newerRevision: null, workerField: null, targetUrn: null }], total: 1, nextCursor: null } })])));
    await settle();
    const t = text(m);
    expect(t).toContain('App');
    expect(t).toContain('7');
    expect(t).toContain('hash-abc');
    expect(t).toContain('Values when served');
    expect(t).toContain('"worker": "wk"');
    expect(t).toContain('Boot prompt');
    expect((m.target.querySelector('[data-testid="served-node"]')?.textContent ?? '').replace(/\s/g, '')).toContain('hrn:node:x:y:boot'); // chip text is spaced
    expect(t).toContain('Current warnings');
    expect(t).toMatch(/not when it was served/);
  });

  it('a pruned record says its served revision is no longer kept; a pruned provenance entry too', async () => {
    const m = show(() => ok(page([record({ pruned: true })])));
    await settle();
    expect(m.target.querySelector('[data-testid="served-pruned"]')?.textContent).toContain('no longer kept');
    expect(m.target.querySelector('[data-testid="served-provenance"]')?.textContent).toContain('no longer kept');
  });

  it('no node => no name and no chip; provenance entries never show a name or a chip', async () => {
    const m = show(() => ok(page([record({ node: null })])));
    await settle();
    expect(m.target.querySelector('[data-testid="served-node"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="served-provenance"]')!.textContent).not.toMatch(/hrn:/);
    expect(m.target.querySelector('[data-testid="served-provenance"] [data-urn], [data-testid="served-provenance"] button')).toBeNull();
  });

  it('the recorded model source is labelled client-reported / unspecified, never verified', async () => {
    // The server records FLAT dotted keys (hadron-server resolvers.mutation.chat.ts), not a nested object.
    const m = show(() => ok(page([record({ variables: { 'session.llmModel': 'x', 'session.llmModel.source': 'client-reported' } })])));
    await settle();
    expect(text(m)).toContain('client-reported');
    expect(text(m).toLowerCase()).not.toContain('verified');
  });

  it('a flat source that is not client-reported reads unspecified; no source key renders no label', async () => {
    const a = show(() => ok(page([record({ variables: { 'session.llmModel.source': 'other' } })])));
    await settle();
    expect(text(a)).toContain('unspecified');
    const b = show(() => ok(page([record({ variables: { 'session.llmModel': 'x' } })])));
    await settle();
    expect(text(b)).not.toContain('unspecified');
    expect(text(b)).not.toContain('client-reported');
  });
});

describe('paging', () => {
  it('records: "1–5 of 12" and Next asks for offset 5; the list needs no hasMore flag', async () => {
    const f = vi.fn((url: string) => ok(page([1, 2, 3, 4, 5].map((n) => record({ id: `r${n}` })), 12, Number(new URL(url, 'http://x').searchParams.get('offset')))));
    const m = show(f as never);
    await settle();
    expect(m.target.querySelector('[data-testid="served-range"]')?.textContent).toBe('1–5 of 12');
    const next = [...m.target.querySelectorAll('button')].find((b) => b.textContent === 'Next')!;
    next.click();
    await settle();
    expect(String(f.mock.calls.at(-1)![0])).toContain('offset=5');
  });

  it('provenance: 20 per page, Next asks only for that record\'s next provenance page', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ revSeq: i, hash: `h${i}`, pruned: false }));
    const f = vi.fn((url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      return ok(page([record({ provenance: { items, total: 45, offset: Number(q.get('provOffset') ?? 0) } })]));
    });
    const m = show(f as never);
    await settle();
    expect(m.target.querySelector('[data-testid="served-prov-range"]')?.textContent).toBe('1–20 of 45');
    [...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="served-provenance"] button')].find((b) => b.textContent === 'Next')!.click();
    await settle();
    expect(String(f.mock.calls.at(-1)![0])).toContain('provOffset=20');
  });

  it('lint: Show more appends the next page using the cursor', async () => {
    const w = (n: number) => ({ kind: 'BROKEN_INCLUDE', position: n, pinnedRevision: null, newerRevision: null, workerField: null, targetUrn: null });
    const f = vi.fn((url: string) => {
      const after = new URL(url, 'http://x').searchParams.get('lintAfter');
      return ok(page([record({ lint: after ? { items: [w(21)], total: 21, nextCursor: null } : { items: [w(1)], total: 21, nextCursor: 'c1' } })]));
    });
    const m = show(f as never);
    await settle();
    [...m.target.querySelectorAll('button')].find((b) => b.textContent === 'Show more')!.click();
    await settle();
    expect(String(f.mock.calls.at(-1)![0])).toContain('lintAfter=c1');
    expect(m.target.querySelectorAll('[data-testid="served-lint"] li').length).toBe(2);
  });
});

describe('review folds at 1435a933 (George P2s, Uma, Rook)', () => {
  it('two legal provenance entries with the same revision and hash (different nodes) both render, no duplicate-key crash', async () => {
    const dup = [{ revSeq: 3, hash: 'same', pruned: false }, { revSeq: 3, hash: 'same', pruned: false }];
    const m = show(() => ok(page([record({ provenance: { items: dup, total: 2, offset: 0 } })])));
    await settle();
    expect(m.target.querySelectorAll('[data-testid="served-provenance"] li')).toHaveLength(2);
  });

  it('Show more answered with currentLint: null turns the section into "Warnings unavailable", not stale warnings', async () => {
    const w = { kind: 'BROKEN_INCLUDE', position: 1, pinnedRevision: null, newerRevision: null, workerField: null, targetUrn: null };
    const f = (url: string) => ok(page([record({ lint: new URL(url, 'http://x').searchParams.get('lintAfter') ? null : { items: [w], total: 21, nextCursor: 'c1' } })]));
    const m = show(f as never);
    await settle();
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Show more')!.click();
    await settle();
    const lint = m.target.querySelector('[data-testid="served-lint"]')!;
    expect(lint.textContent).toContain('Warnings unavailable');
    expect(lint.querySelectorAll('li')).toHaveLength(0);
  });

  it('the lint count follows the newest page total, not the first page\'s (Gloria P3)', async () => {
    const w = (n: number) => ({ kind: 'BROKEN_INCLUDE', position: n, pinnedRevision: null, newerRevision: null, workerField: null, targetUrn: null });
    const f = (url: string) => ok(page([record({ lint: new URL(url, 'http://x').searchParams.get('lintAfter') ? { items: [w(2)], total: 2, nextCursor: null } : { items: [w(1)], total: 5, nextCursor: 'c1' } })]));
    const m = show(f as never);
    await settle();
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Show more')!.click();
    await settle();
    expect(m.target.querySelector('[data-testid="served-lint-count"]')!.textContent!.trim()).toBe('2 of 2');
  });

  it('non-null lint with no items says "No current warnings"', async () => {
    const m = show(() => ok(page([record()])));
    await settle();
    expect(m.target.querySelector('[data-testid="served-lint"]')!.textContent).toContain('No current warnings');
  });

  it('empty provenance renders no Provenance heading', async () => {
    const m = show(() => ok(page([record({ provenance: { items: [], total: 0, offset: 0 } })])));
    await settle();
    expect(m.target.querySelector('[data-testid="served-provenance"]')).toBeNull();
  });

  it('the scrollable values block is keyboard focusable and labelled', async () => {
    const m = show(() => ok(page([record()])));
    await settle();
    const pre = m.target.querySelector('[data-testid="served-variables"] pre')!;
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.getAttribute('aria-label')).toBeTruthy();
  });

  it('a failed nested page says it could not load MORE, and the pager stays usable to retry', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ revSeq: i, hash: `h${i}`, pruned: false }));
    const f = (url: string) => new URL(url, 'http://x').searchParams.get('provOffset')
      ? Promise.resolve(new Response('{}', { status: 502 }))
      : ok(page([record({ provenance: { items, total: 45, offset: 0 } })]));
    const m = show(f as never);
    await settle();
    [...m.target.querySelectorAll<HTMLButtonElement>('[data-testid="served-provenance"] button')].find((b) => b.textContent === 'Next')!.click();
    await settle();
    const prov = m.target.querySelector('[data-testid="served-provenance"]')!;
    expect(prov.querySelector('[role="alert"]')!.textContent).toContain('more');
    const next = [...prov.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Next')!;
    expect(next.disabled).toBe(false);
  });

  it('collapsible: an opened <details> stays open (same element) across Previous/Next paging', async () => {
    const f = vi.fn((url: string) => ok(page([1, 2, 3, 4, 5].map((n) => record({ id: `r${n}` })), 12, Number(new URL(url, 'http://x').searchParams.get('offset')))));
    const m = show(f as never, { collapsible: true });
    await settle();
    const d = m.target.querySelector('details')!;
    d.open = true;
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Next')!.click();
    await settle();
    const after = m.target.querySelector('details')!;
    expect(after).toBe(d);
    expect(after.open).toBe(true);
    expect(m.target.querySelector('[data-testid="served-range"]')!.textContent).toBe('6–10 of 12');
  });

  it('collapsible: closed <details> with the section name, records inside', async () => {
    const m = show(() => ok(page([record()])), { collapsible: true });
    await settle();
    const d = m.target.querySelector('details')!;
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')!.textContent).toContain('Served prompt');
  });
});

describe('a reused host never shows the previous subject', () => {
  it('worker A -> B: A\'s late response is dropped, B\'s shows', async () => {
    let releaseA!: () => void;
    const f = vi.fn((url: string) => {
      const ref = new URL(url, 'http://x').searchParams.get('ref');
      if (ref === 'A') return new Promise<Response>((r) => { releaseA = () => r(new Response(JSON.stringify(page([record({ id: 'a', compiledContentHash: 'HASH-A' })])), { status: 200 })); });
      return ok(page([record({ id: 'b', compiledContentHash: 'HASH-B' })]));
    });
    const props = reactiveProps({ source: 'worker', refId: 'A', fetchImpl: f as never } as Record<string, unknown>);
    const m = mountComponent(ServedPrompt as never, props as never);
    mounted.push(m);
    await tick(2);
    props.refId = 'B';
    flushSync();
    await settle();
    releaseA();
    await settle();
    expect(text(m)).toContain('HASH-B');
    expect(text(m)).not.toContain('HASH-A');
  });

  it('unmounting mid-flight leaves no unhandled rejection and writes nothing', async () => {
    let release!: () => void;
    const f = () => new Promise<Response>((_, rej) => { release = () => rej(new Error('late')); });
    const caught = await captureUnhandledRejections(async () => {
      const m = show(f as never);
      await tick(2);
      m.unmount();
      release();
      await wait(5);
    });
    expect(caught).toEqual([]);
  });
});

// portal#1696 — nested paging state. Lint and provenance page the SAME record independently, so
// their pending and failure state must be independent too (they shared one `busy`/`failed` field:
// starting provenance re-enabled lint "Show more", a second same-cursor lint request appended
// the same warnings twice, "22 of 21").
const lintWarn = (n: number) => ({ kind: 'BROKEN_INCLUDE', position: n, pinnedRevision: null, newerRevision: null, workerField: null, targetUrn: null });
const provItems = Array.from({ length: 20 }, (_, i) => ({ revSeq: i, hash: `h${i}`, pruned: false }));

/** A fetch whose nested lint / provenance replies are held until the test releases them. */
function heldFetch(opts: { lintReply?: () => Response; provReply?: () => Response } = {}) {
  const held: Array<{ kind: 'lint' | 'prov'; url: string; release: () => void }> = [];
  const calls: string[] = [];
  const first = () => record({ provenance: { items: provItems, total: 45, offset: 0 }, lint: { items: [lintWarn(1)], total: 21, nextCursor: 'c1' } });
  const fetchImpl = vi.fn((url: string) => {
    calls.push(url);
    const q = new URL(url, 'http://x').searchParams;
    const kind = q.get('lintAfter') ? 'lint' : q.get('provOffset') !== null ? 'prov' : null;
    if (!kind) return ok(page([first()]));
    return new Promise<Response>((resolve) => {
      held.push({
        kind, url,
        release: () => resolve(
          kind === 'lint'
            ? (opts.lintReply?.() ?? new Response(JSON.stringify(page([record({ lint: { items: [lintWarn(21)], total: 21, nextCursor: null } })])), { status: 200 }))
            : (opts.provReply?.() ?? new Response(JSON.stringify(page([record({ provenance: { items: provItems, total: 45, offset: 20 } })])), { status: 200 })),
        ),
      });
    });
  });
  return { fetchImpl, held, calls, nested: (k: 'lint' | 'prov') => held.filter((h) => h.kind === k) };
}
const button = (m: { target: HTMLElement }, scope: string, label: string) =>
  [...m.target.querySelectorAll<HTMLButtonElement>(`[data-testid="${scope}"] button`)].find((b) => b.textContent === label)!;

describe('portal#1696 item 1: lint and provenance page independently', () => {
  it('provenance starting while lint loads does not re-enable lint "Show more": one lint request, one append', async () => {
    const h = heldFetch();
    const m = show(h.fetchImpl as never);
    await settle();
    button(m, 'served-lint', 'Show more').click();
    flushSync();
    button(m, 'served-provenance', 'Next').click();
    flushSync();
    expect(button(m, 'served-lint', 'Show more').disabled).toBe(true);
    button(m, 'served-lint', 'Show more').click();
    flushSync();
    expect(h.nested('lint')).toHaveLength(1);
    expect(h.nested('prov')).toHaveLength(1);
    h.held.forEach((x) => x.release());
    await settle();
    expect(m.target.querySelectorAll('[data-testid="served-lint"] li')).toHaveLength(2);
    expect(m.target.querySelector('[data-testid="served-lint-count"]')!.textContent!.trim()).toBe('2 of 21');
  });

  it('lint finishing while provenance loads does not re-enable provenance "Next": one provenance request', async () => {
    const h = heldFetch();
    const m = show(h.fetchImpl as never);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    flushSync();
    button(m, 'served-lint', 'Show more').click();
    flushSync();
    h.nested('lint')[0].release();
    await settle();
    expect(button(m, 'served-provenance', 'Next').disabled).toBe(true);
    button(m, 'served-provenance', 'Next').click();
    flushSync();
    expect(h.nested('prov')).toHaveLength(1);
  });

  it('a lint failure survives a provenance request starting and succeeding', async () => {
    const h = heldFetch({ lintReply: () => new Response('{}', { status: 502 }) });
    const m = show(h.fetchImpl as never);
    await settle();
    button(m, 'served-lint', 'Show more').click();
    flushSync();
    h.nested('lint')[0].release();
    await settle();
    expect(m.target.querySelector('[data-testid="served-lint"] [role="alert"]')).not.toBeNull();
    button(m, 'served-provenance', 'Next').click();
    flushSync();
    expect(m.target.querySelector('[data-testid="served-lint"] [role="alert"]')).not.toBeNull();
    h.nested('prov')[0].release();
    await settle();
    expect(m.target.querySelector('[data-testid="served-lint"] [role="alert"]')).not.toBeNull();
    expect(m.target.querySelector('[data-testid="served-provenance"] [role="alert"]')).toBeNull();
  });

  it('a provenance failure survives a later lint request', async () => {
    const h = heldFetch({ provReply: () => new Response('{}', { status: 502 }) });
    const m = show(h.fetchImpl as never);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    flushSync();
    h.nested('prov')[0].release();
    await settle();
    expect(m.target.querySelector('[data-testid="served-provenance"] [role="alert"]')).not.toBeNull();
    button(m, 'served-lint', 'Show more').click();
    flushSync();
    h.nested('lint')[0].release();
    await settle();
    expect(m.target.querySelector('[data-testid="served-provenance"] [role="alert"]')).not.toBeNull();
  });

  it('a subject change while a nested page is in flight clears pending state and drops the stale reply', async () => {
    const h = heldFetch();
    const f = vi.fn((url: string) => (new URL(url, 'http://x').searchParams.get('ref') === 'B'
      ? ok(page([record({ id: 'rec-b', lint: { items: [lintWarn(7)], total: 21, nextCursor: 'cB' } })]))
      : h.fetchImpl(url)));
    const props = reactiveProps({ source: 'worker', refId: 'A', fetchImpl: f as never } as Record<string, unknown>);
    const m = mountComponent(ServedPrompt as never, props as never);
    mounted.push(m);
    await settle();
    button(m, 'served-lint', 'Show more').click();
    flushSync();
    props.refId = 'B';
    flushSync();
    await settle();
    expect(button(m, 'served-lint', 'Show more').disabled).toBe(false);
    h.nested('lint')[0].release();
    await settle();
    expect(m.target.querySelectorAll('[data-testid="served-lint"] li')).toHaveLength(1);
    expect(button(m, 'served-lint', 'Show more').disabled).toBe(false);
  });
});

// Item 2 is an OUT-OF-CONTRACT defensive guard, not a production scenario: the provider slices an
// immutable stored array and reports its length (resolvers.servedPrompt.ts:138-146), so a real
// provider never answers a later page with empty items for an unchanged record. These fakes
// exercise the guard only.
describe('portal#1696 item 2 (out-of-contract fake): an empty later provenance page', () => {
  const emptyLater = { items: [] as unknown[], total: 45, offset: 20 };
  function provFetch(later: (q: URLSearchParams) => Response) {
    return vi.fn((url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('provOffset') === null) return ok(page([record({ provenance: { items: provItems, total: 45, offset: 0 } })]));
      return Promise.resolve(later(q));
    });
  }
  const provCalls = (f: ReturnType<typeof provFetch>) => f.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams.get('provOffset')).filter((v) => v !== null);

  it('resets once to the first page: the section and its range come back, same query', async () => {
    const f = provFetch((q) => new Response(JSON.stringify(page([record({ provenance: q.get('provOffset') === '0' ? { items: provItems, total: 45, offset: 0 } : emptyLater })])), { status: 200 }));
    const m = show(f as never);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    await settle();
    expect(provCalls(f)).toEqual(['20', '0']);
    expect(m.target.querySelector('[data-testid="served-prov-range"]')!.textContent).toBe('1–20 of 45');
    expect(m.target.querySelector('[data-testid="served-provenance"] [role="alert"]')).toBeNull();
  });

  it('a failed reset shows the existing failure and never an empty section', async () => {
    const f = provFetch((q) => (q.get('provOffset') === '0' ? new Response('{}', { status: 502 }) : new Response(JSON.stringify(page([record({ provenance: emptyLater })])), { status: 200 })));
    const m = show(f as never);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    await settle();
    const prov = m.target.querySelector('[data-testid="served-provenance"]');
    expect(prov).not.toBeNull();
    expect(prov!.querySelector('[role="alert"]')!.textContent).toContain('more');
    expect(prov!.querySelectorAll('li').length).toBeGreaterThan(0);
  });

  it('resets ONCE: a reset that is empty again does not loop', async () => {
    const f = provFetch(() => new Response(JSON.stringify(page([record({ provenance: emptyLater })])), { status: 200 }));
    const m = show(f as never);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    await wait(60);
    flushSync();
    expect(provCalls(f)).toEqual(['20', '0']);
  });

  it('total 0 keeps the honest state: no section, no "none" text, no reset request', async () => {
    const f = provFetch(() => new Response(JSON.stringify(page([record({ provenance: { items: [], total: 0, offset: 20 } })])), { status: 200 }));
    const m = show(f as never);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    await settle();
    expect(provCalls(f)).toEqual(['20']);
    expect(m.target.querySelector('[data-testid="served-provenance"]')).toBeNull();
    expect(text(m)).not.toMatch(/no provenance|none/i);
  });

  it('a subject change during the reset drops it: nothing repaints for the new subject', async () => {
    let releaseReset!: () => void;
    const f = vi.fn((url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('ref') === 'B') return ok(page([record({ id: 'rec-b', compiledContentHash: 'HASH-B', provenance: { items: [{ revSeq: 9, hash: 'pb', pruned: false }], total: 1, offset: 0 } })]));
      if (q.get('provOffset') === '0') return new Promise<Response>((r) => { releaseReset = () => r(new Response(JSON.stringify(page([record({ compiledContentHash: 'HASH-A', provenance: { items: provItems, total: 45, offset: 0 } })])), { status: 200 })); });
      if (q.get('provOffset') !== null) return ok(page([record({ provenance: emptyLater })]));
      return ok(page([record({ compiledContentHash: 'HASH-A', provenance: { items: provItems, total: 45, offset: 0 } })]));
    });
    const props = reactiveProps({ source: 'worker', refId: 'A', fetchImpl: f as never } as Record<string, unknown>);
    const m = mountComponent(ServedPrompt as never, props as never);
    mounted.push(m);
    await settle();
    button(m, 'served-provenance', 'Next').click();
    await settle();
    props.refId = 'B';
    flushSync();
    await settle();
    releaseReset();
    await settle();
    expect(text(m)).toContain('HASH-B');
    expect(text(m)).not.toContain('HASH-A');
  });
});
