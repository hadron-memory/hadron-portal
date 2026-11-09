import { flushSync, mount, unmount } from 'svelte';
import TabRowLayout from './TabRowLayout.svelte';
import type { TabRowItem } from '$lib/components/TabRow.svelte';
export function mountRow(target: HTMLElement, mode: 'tabs' | 'links', items: TabRowItem[], selected: string) {
  const instance = mount(TabRowLayout, { target, props: { mode, items, selected } });
  flushSync();
  return () => unmount(instance);
}
