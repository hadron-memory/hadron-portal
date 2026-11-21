// #2029: real TerminalStatus, deterministic legal terminal report, no API.
import { mount, unmount } from 'svelte';
import TerminalStatus from '$lib/components/TerminalStatus.svelte';
import { terminalBadge } from '$lib/workers/terminal';
export function mountTerminalFixture(target: HTMLElement, mode: string, compact = true) {
  const now = Date.parse('2026-11-12T09:00:00Z');
  const badge = mode === 'hidden' ? null : terminalBadge(mode === 'not-reported' ? null : {
    status: 'dark', reason: 'bare_shell', checkedAt: '2026-11-12T08:44:00Z', lastTurnAt: null,
  }, true, now);
  const instance = mount(TerminalStatus, { target, props: { badge, now, compact } });
  return () => unmount(instance);
}
