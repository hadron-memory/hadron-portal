/**
 * portal#2194 — the worker page's leave-alone marker, mounted. A null marker is
 * "not shown" and renders nothing; a marked worker shows its reason, who set it
 * and when; only a manager gets Leave alone… / Clear; a refusal is shown as the
 * server worded it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import WorkerLeaveAlone from './WorkerLeaveAlone.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});
type Props = { marker: { on: boolean; reason: string | null; by: string | null; at: string | null } | null; canManage: boolean; retired?: boolean };
function mountIt(props: Props) {
  const m = mountComponent(WorkerLeaveAlone as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}
const buttons = (root: HTMLElement) => [...root.querySelectorAll('button')].map((b) => b.textContent!.trim());
const MARKED = { on: true, reason: 'host migration', by: 'ada', at: '2026-11-15T12:00:00Z' };

describe('worker leave-alone marker (portal#2194)', () => {
  it('renders nothing when the marker is withheld (profile tier), which is not "not marked"', async () => {
    const root = mountIt({ marker: null, canManage: true });
    await tick();
    expect(root.querySelector('section')).toBeNull();
  });

  it('shows the reason, who set it and when for a marked worker', async () => {
    const root = mountIt({ marker: MARKED, canManage: false });
    await tick();
    const text = root.textContent!;
    expect(text).toContain('host migration');
    expect(text).toContain('ada');
    expect(buttons(root)).toEqual([]);
  });

  it('gives a manager Clear on a marked worker, posting leaveAlone=false', async () => {
    const root = mountIt({ marker: MARKED, canManage: true });
    await tick();
    expect(buttons(root)).toEqual(['Clear']);
    const form = root.querySelector<HTMLFormElement>('form[action="?/setLeaveAlone"]')!;
    expect(new FormData(form).get('leaveAlone')).toBe('false');
  });

  it('gives a manager Leave alone… on an unmarked worker, asking for an optional reason', async () => {
    const root = mountIt({ marker: { on: false, reason: null, by: null, at: null }, canManage: true });
    await tick();
    expect(buttons(root)).toEqual(['Leave alone…']);
    root.querySelector('button')!.click();
    flushSync();
    const form = root.querySelector<HTMLFormElement>('form')!;
    expect(new FormData(form).get('leaveAlone')).toBe('true');
    expect(root.querySelector<HTMLInputElement>('input[name="reason"]')!.maxLength).toBe(500);
    expect(buttons(root)).toEqual(['Save', 'Cancel']);
  });

  it('offers no controls on a retired worker', async () => {
    const root = mountIt({ marker: MARKED, canManage: true, retired: true });
    await tick();
    expect(buttons(root)).toEqual([]);
  });

  it('shows the server refusal as worded', async () => {
    const root = mountIt({ marker: MARKED, canManage: true });
    await submitEnhancedWithResult(root.querySelector('form')!, { type: 'failure', status: 403, data: { leaveAloneError: 'Only a manager of the App may change this.' } });
    flushSync();
    expect(root.querySelector('[role="alert"]')!.textContent).toBe('Only a manager of the App may change this.');
  });
});
