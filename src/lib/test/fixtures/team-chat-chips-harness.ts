import { mount } from 'svelte';
import Harness from './TeamChatChipsHarness.svelte';
export function mountTeamChatChips(target: HTMLElement, delaySelection = false) {
  const app = mount(Harness, { target, props: { delaySelection } });
  return { applyPendingFilter: () => app.applyPendingFilter() };
}
