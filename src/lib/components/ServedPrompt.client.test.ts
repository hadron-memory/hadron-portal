/**
 * portal#1665: the served-record view, mounted. The cases here are the ones a server render cannot see:
 * a response landing after the subject changed or the component went away, and the nested pagers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, wait, captureUnhandledRejections, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import ServedPrompt from './ServedPrompt.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const prov = (n: number, offset = 0, total = n) => ({ items: Array.from({ length: n }, (_, i) => ({ revSeq: offset + i + 1, hash: `hash-${offset + i}`, pruned: false })), total, offset });
const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'BIND', ordinal: 1, pointerLevel: 'APP_AGENT', servedAt: '2026-11-04T00:00:00Z', servedRevSeq: 4, provenanceRevSeq: 4, pruned: false,
  compiledContentHash: `chash-${id}`, variables: { who: id }, node: { urn: `hrn:node:x:y:${id}`, name: `Name ${id}` },
  provenance: prov(2), lint: { items: [], total: 0, nextCursor: null }, ...over,
});
const page = (items: unknown[], total = items.length, offset = 0) => ({ items, total, offset });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** fetch → json() takes several turns; a real timer lets all of them land. */
const settle = async () => { await wait(5); await tick(2); };

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; }

async function mountIt(fetchImpl: ReturnType<typeof vi.fn>, props: Record<string, unknown> = {}) {
  const p = reactiveProps<Record<string, unknown>>({ source: 'worker', refId: 'w1', fetchImpl, ...props });
  const m = mountComponent(ServedPrompt as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return { root: m.target, props: p, unmount: m.unmount };
}
const urlOf = (f: ReturnType<typeof vi.fn>, n: number) => new URL(String(f.mock.calls[n][0]), 'http://x').searchParams;

describe('ServedPrompt', () => {
  it('an empty page renders NO section and no "no records" text (concealment)', async () => {
    const { root } = await mountIt(vi.fn(async () => ok(page([]))));
    expect(root.textContent?.trim()).toBe('');
    expect(root.querySelector('[data-testid="served-prompt"]')).toBeNull();
  });

  it('a failed read says it could not load, and is never shown as empty', async () => {
    const { root } = await mountIt(vi.fn(async () => new Response('{}', { status: 502 })));
    expect(root.querySelector('[data-testid="served-prompt-failed"]')?.textContent).toContain('Couldn’t load the served prompt.');
    expect(root.querySelector('[data-testid="served-prompt"]')).toBeNull();
  });

  it('a thrown fetch is the same failure', async () => {
    const { root } = await mountIt(vi.fn(async () => { throw new Error('offline'); }));
    expect(root.querySelector('[data-testid="served-prompt-failed"]')).not.toBeNull();
  });

  it('shows the name and URN chip only when the endpoint returned a node; none otherwise', async () => {
    const withNode = await mountIt(vi.fn(async () => ok(page([rec('a')]))));
    expect(withNode.root.querySelector('[data-testid="served-node"]')?.textContent).toContain('Name a');
    expect(withNode.root.querySelector('[title="hrn:node:x:y:a"]')).not.toBeNull();
    const without = await mountIt(vi.fn(async () => ok(page([rec('b', { node: null })]))));
    expect(without.root.querySelector('[data-testid="served-node"]')).toBeNull();
    expect(without.root.textContent).not.toContain('Name b');
  });

  it('labels variables as values when served, and a pruned record says so', async () => {
    const { root } = await mountIt(vi.fn(async () => ok(page([rec('a', { pruned: true })]))));
    expect(root.querySelector('[data-testid="served-variables"]')?.textContent).toContain('Values when served');
    expect(root.querySelector('[data-testid="served-pruned"]')?.textContent).toContain('no longer kept');
  });

  it('model source is client-reported or unspecified, never verified', async () => {
    const v = (source: string) => ({ session: { llmModel: { id: 'm', source } } });
    const a = await mountIt(vi.fn(async () => ok(page([rec('a', { variables: v('client-reported') })]))));
    expect(a.root.textContent).toContain('Model: client-reported');
    const b = await mountIt(vi.fn(async () => ok(page([rec('b', { variables: v('whatever') })]))));
    expect(b.root.textContent).toContain('Model: unspecified');
    expect(b.root.textContent).not.toMatch(/verified/i);
  });

  it('null lint is "Warnings unavailable", never "no warnings"', async () => {
    const { root } = await mountIt(vi.fn(async () => ok(page([rec('a', { lint: null })]))));
    const lint = root.querySelector('[data-testid="served-lint"]')!.textContent!;
    expect(lint).toContain('Warnings unavailable');
    expect(lint).not.toMatch(/no warnings|0 of/i);
  });

  it('records page by total: "x–y of total", Next fetches the next offset, Previous goes back', async () => {
    const f = vi.fn(async (u: string) => {
      const o = Number(new URL(u, 'http://x').searchParams.get('offset'));
      return ok(page(o === 0 ? [rec('r1'), rec('r2'), rec('r3'), rec('r4'), rec('r5')] : [rec('r6'), rec('r7')], 7, o));
    });
    const { root } = await mountIt(f, { source: 'session', refId: 's1' });
    expect(root.querySelector('[data-testid="served-range"]')?.textContent).toBe('1–5 of 7');
    const next = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Next') as HTMLElement;
    next.click();
    await settle();
    expect(urlOf(f, 1).get('offset')).toBe('5');
    expect(root.querySelector('[data-testid="served-range"]')?.textContent).toBe('6–7 of 7');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Next')).toBe(false);
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Previous') as HTMLElement).click();
    await settle();
    expect(urlOf(f, 2).get('offset')).toBe('0');
  });

  it('a full page is not called complete while offset + count < total (provenance Next fetches offset 20)', async () => {
    const f = vi.fn(async (u: string) => {
      const q = new URL(u, 'http://x').searchParams;
      return q.get('provOffset') === '20'
        ? ok(page([rec('r1', { provenance: prov(5, 20, 25) })], 1))
        : ok(page([rec('r1', { provenance: prov(20, 0, 25) })], 1));
    });
    const { root } = await mountIt(f);
    expect(root.querySelector('[data-testid="served-prov-range"]')?.textContent).toBe('1–20 of 25');
    ([...root.querySelectorAll('[data-testid="served-provenance"] button')].find((b) => b.textContent === 'Next') as HTMLElement).click();
    await settle();
    expect(urlOf(f, 1).get('provOffset')).toBe('20');
    expect(urlOf(f, 1).get('limit')).toBe('1'); // siblings are not re-paged
    expect(root.querySelector('[data-testid="served-prov-range"]')?.textContent).toBe('21–25 of 25');
    expect([...root.querySelectorAll('[data-testid="served-provenance"] button')].some((b) => b.textContent === 'Next')).toBe(false);
  });

  it('lint "Show more" follows nextCursor and appends: "n of total"', async () => {
    const w = (n: number) => ({ kind: 'BROKEN_INCLUDE', position: n, pinnedRevision: null, newerRevision: null, workerField: null, targetUrn: null });
    const f = vi.fn(async (u: string) => {
      const q = new URL(u, 'http://x').searchParams;
      return q.get('lintAfter') === 'cur-1'
        ? ok(page([rec('r1', { lint: { items: [w(3)], total: 3, nextCursor: null } })], 1))
        : ok(page([rec('r1', { lint: { items: [w(1), w(2)], total: 3, nextCursor: 'cur-1' } })], 1));
    });
    const { root } = await mountIt(f);
    expect(root.querySelector('[data-testid="served-lint-count"]')?.textContent?.trim()).toBe('2 of 3');
    ([...root.querySelectorAll('[data-testid="served-lint"] button')].find((b) => b.textContent === 'Show more') as HTMLElement).click();
    await settle();
    expect(urlOf(f, 1).get('lintAfter')).toBe('cur-1');
    expect(root.querySelector('[data-testid="served-lint-count"]')?.textContent?.trim()).toBe('3 of 3');
    expect(root.querySelectorAll('[data-testid="served-lint"] li').length).toBe(3);
    expect([...root.querySelectorAll('[data-testid="served-lint"] button')].length).toBe(0);
  });

  it('a nested page whose record moved reloads instead of showing a sibling', async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      if (n === 1) return ok(page([rec('r1', { provenance: prov(20, 0, 25) })], 1));
      if (n === 2) return ok(page([rec('SOMEONE-ELSE')], 1)); // the nested ask landed on a different record
      return ok(page([rec('r1', { provenance: prov(20, 0, 25) })], 1));
    });
    const { root } = await mountIt(f);
    ([...root.querySelectorAll('[data-testid="served-provenance"] button')].find((b) => b.textContent === 'Next') as HTMLElement).click();
    await settle();
    expect(root.textContent).not.toContain('SOMEONE-ELSE');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('switching worker A to worker B while A is in flight never shows A', async () => {
    const a = deferred<Response>();
    const f = vi.fn((u: string) => (new URL(u, 'http://x').searchParams.get('ref') === 'wA' ? a.promise : Promise.resolve(ok(page([rec('B')])))));
    const { root, props } = await mountIt(f, { refId: 'wA' });
    props.refId = 'wB';
    await settle();
    a.resolve(ok(page([rec('A')])));
    await settle();
    expect(root.textContent).toContain('Name B');
    expect(root.textContent).not.toContain('Name A');
    expect(root.textContent).not.toContain('chash-A');
  });

  it('switching chats while the first is in flight never shows the earlier chat', async () => {
    const a = deferred<Response>();
    const f = vi.fn((u: string) => (new URL(u, 'http://x').searchParams.get('chatId') === 'c1' ? a.promise : Promise.resolve(ok(page([rec('C2', { kind: 'CHAT' })])))));
    const { root, props } = await mountIt(f, { source: 'chat', refId: null, agentId: 'ag', chatId: 'c1' });
    props.chatId = 'c2';
    await settle();
    a.resolve(ok(page([rec('C1', { kind: 'CHAT' })])));
    await settle();
    expect(root.textContent).toContain('Name C2');
    expect(root.textContent).not.toContain('Name C1');
  });

  it('the late failure of the earlier subject does not blank the current one', async () => {
    const a = deferred<Response>();
    const f = vi.fn((u: string) => (new URL(u, 'http://x').searchParams.get('ref') === 'wA' ? a.promise : Promise.resolve(ok(page([rec('B')])))));
    const { root, props } = await mountIt(f, { refId: 'wA' });
    props.refId = 'wB';
    await settle();
    a.resolve(new Response('{}', { status: 502 }));
    await settle();
    expect(root.querySelector('[data-testid="served-prompt-failed"]')).toBeNull();
    expect(root.textContent).toContain('Name B');
  });

  it('a response landing after unmount throws nothing into the void', async () => {
    const a = deferred<Response>();
    const f = vi.fn(() => a.promise);
    const { unmount } = await mountIt(f);
    const caught = await captureUnhandledRejections(async () => {
      unmount();
      a.resolve(ok(page([rec('A')])));
      await wait(5);
    });
    expect(caught).toEqual([]);
  });

  it('chat asks with agentId + chatId and never a record id', async () => {
    const f = vi.fn(async () => ok(page([])));
    await mountIt(f, { source: 'chat', refId: null, agentId: 'ag', chatId: 'loc-1' });
    const q = urlOf(f, 0);
    expect([q.get('source'), q.get('agentId'), q.get('chatId'), q.get('ref')]).toEqual(['chat', 'ag', 'loc-1', null]);
  });
});
