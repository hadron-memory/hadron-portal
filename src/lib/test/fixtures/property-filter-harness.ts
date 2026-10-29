import { flushSync, mount, unmount } from 'svelte';
import PropertyFilter from '$lib/components/PropertyFilter.svelte';

/** Synthetic component preview; independent QA owns the real MemoryBrowser flow. */
export function mountPropertyFilter(target: HTMLElement) {
  const component = mount(PropertyFilter, { target, props: { collection: { fields: {
    status: { type: 'enum', values: ['', 'draft', 'published'] },
    priority: { type: 'number' }, enabled: { type: 'boolean' },
    publishedAt: { type: 'datetime' }, title: { type: 'text' },
  } } } });
  flushSync();
  return () => unmount(component);
}
