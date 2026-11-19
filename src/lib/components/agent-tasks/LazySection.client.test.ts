/**
 * portal#2261 (Gil's P2 on #2263): the page reuses one LazySection across tasks, so a read still in
 * flight for task A must never fill task B's section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import LazySection from './LazySection.svelte';

type Observer = { cb: IntersectionObserverCallback; fire: () => void };
let observers: Observer[] = [];
const mounted: Array<Mounted<Record<string, unknown>>> = [];

class FakeObserver {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    observers.push({ cb, fire: () => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never) });
  }
  observe() {}
  disconnect() {}
}

/** One pending fetch per call, resolved by the test in whatever order it likes. */
let pending: Array<{ url: string; signal: AbortSignal | undefined; answer: (kind: string) => void }> = [];

beforeEach(() => {
  observers = [];
  pending = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      pending.push({ url, signal: init?.signal ?? undefined, answer: (kind) => resolve({ ok: true, status: 200, json: async () => ({ kind }) }) });
    }),
  );
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

const children = createRawSnippet<[{ kind: string }]>((answer) => ({ render: () => `<span data-answer>${answer().kind}</span>` }));

async function mountSection(taskId: string) {
  const props = reactiveProps({ appId: 'app-1', taskId, section: 'history', children } as Record<string, unknown>);
  const m = mountComponent(LazySection as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(6);
  return { props, root: m.target };
}
const shown = () => observers.at(-1)!.fire();
const answer = (root: HTMLElement) => root.querySelector('[data-answer]')?.textContent ?? null;

describe('LazySection across tasks', () => {
  it('a read in flight for task A never fills task B; B reads once when shown', async () => {
    const { props, root } = await mountSection('A');
    shown();
    await tick(6);
    expect(pending).toHaveLength(1);
    expect(pending[0].url).toContain('/tasks/A/sections');

    props.taskId = 'B'; // the reader follows a link to another task while A's read is in flight
    await tick(6);
    expect(pending[0].signal?.aborted).toBe(true);
    pending[0].answer('answer-for-A'); // A's answer arrives late
    await tick(6);
    expect(answer(root)).toBeNull();

    shown(); // B's section is shown
    await tick(6);
    expect(pending).toHaveLength(2);
    expect(pending[1].url).toContain('/tasks/B/sections');
    pending[1].answer('answer-for-B');
    await tick(6);
    expect(answer(root)).toBe('answer-for-B');
  });

  it('an answered section still starts over for another task', async () => {
    const { props, root } = await mountSection('A');
    shown();
    await tick(6);
    pending[0].answer('answer-for-A');
    await tick(6);
    expect(answer(root)).toBe('answer-for-A');
    props.taskId = 'B';
    await tick(6);
    expect(answer(root)).toBeNull();
    shown();
    await tick(6);
    expect(pending[1].url).toContain('/tasks/B/sections');
  });
});
