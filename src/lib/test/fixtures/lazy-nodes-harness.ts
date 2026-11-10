// portal#1700: mounts the real LazyNodesBrowser for scripts/test-nodes-tab-lazy.mjs.
// Loaded through Vite so `$lib` and the component's Svelte compile apply. Real Chromium is the
// point: windowing, scrolling and the 390px layout are things jsdom does not compute.
import { mount } from 'svelte';
import LazyNodesBrowser from '$lib/components/LazyNodesBrowser.svelte';

export function mountLazyNodes(target: HTMLElement, memoryId: string) {
  return mount(LazyNodesBrowser as never, { target, props: { memoryId } as never });
}
