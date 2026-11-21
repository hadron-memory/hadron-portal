import { mount } from 'svelte';
import Harness from '$lib/test/LiveOutcomeLayoutHarness.svelte';
export function mountColumn(target: HTMLElement, props: { mode: 'plain' | 'region' | 'outcome'; hasFollowingControl: boolean }) {
  return mount(Harness, { target, props }) as unknown as { say: (note: { text: string; failed: boolean } | null) => void };
}
