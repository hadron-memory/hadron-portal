// #2029: real TerminalStatus, deterministic legal terminal report, no API.
import { mount, unmount } from 'svelte';
import TerminalStatus from '$lib/components/TerminalStatus.svelte';
import { terminalBadge } from '$lib/workers/terminal';
/** 'dark' shows a reported terminal; 'not-reported' is a report that is null (renders "Not reported"); 'hidden' is no badge at all (renders nothing). */
export type TerminalFixtureMode = 'dark' | 'not-reported' | 'hidden';
export function mountTerminalFixture(target: HTMLElement, mode: TerminalFixtureMode, compact = true) {
  const now = Date.parse('2026-11-12T09:00:00Z');
  const badge = mode === 'hidden' ? null : terminalBadge(mode === 'not-reported' ? null : {
    status: 'dark', reason: 'bare_shell', checkedAt: '2026-11-12T08:44:00Z', lastTurnAt: null,
  }, true, now);
  const instance = mount(TerminalStatus, { target, props: { badge, now, compact } });
  return () => unmount(instance);
}
