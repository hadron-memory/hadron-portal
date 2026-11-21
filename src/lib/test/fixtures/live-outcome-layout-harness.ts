import { mount } from 'svelte';
import Harness from '$lib/test/LiveOutcomeLayoutHarness.svelte';
export function mountColumn(target: HTMLElement, props: { mode: 'plain' | 'region' | 'outcome'; note: { text: string; failed: boolean } | null; trailing: boolean }) {
  return mount(Harness, { target, props });
}
