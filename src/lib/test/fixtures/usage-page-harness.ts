// #1112: mounts the real memory Usage page for scripts/test-usage-toolbar-layout.mjs.
// Loaded through Vite, so `$lib` aliases and the page's own Svelte compile apply.
import { flushSync, mount, unmount } from 'svelte';
import UsagePage from '../../../routes/app/memories/[id]/usage/+page.svelte';

export function mountUsagePage(target: HTMLElement): () => void {
  const data = { graph: { id: 'm1', name: 'Phone layout memory' }, events: [] };
  const page = mount(UsagePage, { target, props: { data } as never });
  flushSync();
  return () => unmount(page);
}
