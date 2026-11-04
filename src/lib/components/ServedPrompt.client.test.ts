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
    const m = show(() => ok(page([record({ variables: { session: { llmModel: { source: 'client-reported', name: 'x' } } } })])));
    await settle();
    expect(text(m)).toContain('client-reported');
    expect(text(m).toLowerCase()).not.toContain('verified');
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
