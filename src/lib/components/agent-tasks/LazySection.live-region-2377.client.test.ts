/**
 * portal#2344 / #2377: a lazy section's fallback label is a persistent LiveRegion. The section is
 * unread (labelled) at mount, so the label is present at mount; the pin is the identity of the
 * region across read -> answered -> reset to another task, with the text coming and going inside it.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { answerSnippet } from '$lib/test/answerSnippet.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import LazySection from './LazySection.svelte';

let fire: (() => void) | null = null;
let finish: ((kind: string) => void) | null = null;
const mounted: Array<Mounted<Record<string, unknown>>> = [];

class FakeObserver {
  constructor(cb: IntersectionObserverCallback) { fire = () => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never); }
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('fetch', () => new Promise((resolve) => { finish = (kind) => resolve({ ok: true, status: 200, json: async () => ({ kind }) }); }));
});
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });

it('the label lives in one persistent region: present while unread, gone once answered, back after a reset', async () => {
  const props = reactiveProps({ appId: 'app-1', taskId: 'A', section: 'history', children: answerSnippet } as Record<string, unknown>);
  const m = mountComponent(LazySection as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(6);

  const region = m.target.querySelector<HTMLElement>('[role="status"]');
  expect(region).not.toBeNull();
  expect(region!.textContent).toContain('Loading'); // unread at mount: the label is the first content

  fire!(); await tick(6);
  finish!('answer-A'); await tick(6);
  expect(m.target.querySelector('[data-answer]')?.textContent).toBe('answer-A');
  expect(m.target.querySelector('[role="status"]')).toBe(region); // AFTER: same element
  expect(region!.textContent?.trim()).toBe(''); // and quiet

  props.taskId = 'B'; await tick(6); // reset to unread
  expect(m.target.querySelector('[role="status"]')).toBe(region); // still the same element
  expect(region!.textContent).toContain('Loading');
});
