import { mount } from 'svelte';
import Harness from '$lib/test/DataTableFitOnPhoneHarness.svelte';

/** A DataTable wider than its box, with or without a pinned end column (the phone-width scroll cue, #2503). */
export function mountCue(target: HTMLElement, props: { stickyEndColumn?: string }) {
  return mount(Harness, { target, props: { fitOnPhone: false, multiColumn: true, secondSize: 400, ...props } });
}
