import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import EscapeHostHarness from '$lib/test/EscapeHostHarness.svelte';
import SelectTask from './SelectTask.svelte';
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
const choice = (id = 't1', appId = 'app') => ({ id, appId, title: `Title ${id}`, handle: 'AT1.2', status: 'PENDING' });
const answer = (items: unknown[], hasMore = false) => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore } }) });
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
async function mount() { const m = mountComponent(SelectTask, { appId: 'app', open: true, onselect: vi.fn() }); mounted.push(m); await tick(5); return m; }
describe('SelectTask real mounted async picker', () => {
  it('loads beyond 200 and labels filtering as loaded-only', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer(Array.from({ length: 200 }, (_, i) => choice(String(i))), true)).mockResolvedValueOnce(answer([choice('201')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    expect(m.target.textContent).toContain('Search filters loaded pages only');
    button(m.target, 'Load more tasks').click(); await tick(5);
    expect(fetch.mock.calls[1][0]).toContain('offset=200');
    expect(button(m.target, 'Load more tasks')).toBeUndefined();
  });
  it('does not expose a foreign exact response or offer a selection from it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(answer([choice('foreign', 'another')]));
    vi.stubGlobal('fetch', fetch); const m = await mount();
    const input = m.target.querySelector<HTMLInputElement>('input')!;
    input.value = 'AT2.3'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    button(m.target, 'Look up').click(); await tick(5);
    expect(m.target.textContent).not.toContain('Title foreign');
    expect(m.target.textContent).not.toContain('Title old');
    expect(m.target.textContent).toContain('Couldn’t load tasks');
  });
  it('portal#2378: "No open tasks to choose from." is announced by a region that exists, empty, while loading', async () => {
    let finish!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const m = await mount();
    const region = () => m.target.querySelector<HTMLElement>('[data-testid="task-picker-empty"]');
    const before = region();
    expect(before, 'mounted while the read is in flight').not.toBeNull();
    expect(before!.getAttribute('role')).toBe('status');
    expect(before!.textContent?.trim()).toBe('');
    finish(answer([]));
    await tick(5);
    expect(region()).toBe(before);
    expect(before!.textContent).toContain('No open tasks to choose from.');
  });
  it('portal#2378: "No available task found" after an exact lookup lands in a region that was already there', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(answer([]));
    vi.stubGlobal('fetch', fetch); const m = await mount();
    const region = () => m.target.querySelector<HTMLElement>('[data-testid="task-picker-exact-empty"]');
    const before = region();
    expect(before, 'mounted before any lookup').not.toBeNull();
    expect(before!.getAttribute('role')).toBe('status');
    expect(before!.textContent?.trim()).toBe('');
    const input = m.target.querySelector<HTMLInputElement>('input')!;
    input.value = 'AT2.3'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    button(m.target, 'Look up').click(); await tick(5);
    expect(region()).toBe(before);
    expect(before!.textContent).toContain('No available task found in this App.');
  });
  it('drops a pending response after unmount', async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const m = await mount(); m.unmount(); finish(answer([choice()])); await tick(5);
    expect(m.target.textContent).not.toContain('Title t1');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
  // portal#1392 (Rook's optional §10 pin on #1388): a response for the window the picker has LEFT —
  // still mounted, now showing another App — is dropped by the generation guard, not merely by teardown.
  it('drops a late response from before a live App change while staying mounted', async () => {
    const finishes: Array<(value: unknown) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finishes.push(resolve); })));
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app', open: true, onselect: vi.fn() });
    const m = mountComponent(SelectTask as never, props as never); mounted.push(m); await tick(5);
    props.appId = 'other'; await tick(5); flushSync();
    expect(finishes).toHaveLength(2);
    finishes[0](answer([choice('stale', 'app')])); await tick(5);
    expect(m.target.isConnected).toBe(true);
    expect(m.target.textContent).not.toContain('Title stale');
    finishes[1](answer([choice('fresh', 'other')])); await tick(5);
    expect(m.target.textContent).toContain('Title fresh');
    expect(m.target.textContent).not.toContain('Title stale');
  });
  it('reports repeated pages instead of claiming the list complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer([choice()], true)).mockResolvedValueOnce(answer([choice()], true)));
    const m = await mount(); button(m.target, 'Load more tasks').click(); await tick(5);
    expect(m.target.textContent).toContain('Some tasks may be missing');
    expect(button(m.target, 'Load more tasks')).toBeUndefined();
  });
});

// #1584 fold — SelectTask is a Select-family picker (role=dialog, trap,
// DataTable) and was the one left on a bare `if (Escape) open = false`:
// a keystroke bubbled to window and closed the host layer too (TaskActionBar
// listens there, TaskActionBar.svelte:233), and a focus dropped to <body>
// left it keyboard-unclosable — the exact defect class the issue claims to
// have closed everywhere. Same pins as the five movers.
describe('SelectTask: Escape closes one layer only (#1584 fold)', () => {
  const hostDialog = () => document.querySelector<HTMLElement>('[data-host-dialog]');
  const overlay = () => document.querySelector<HTMLElement>('.fixed.inset-0');

  function openInHost() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer([choice()])));
    const m = mountComponent(EscapeHostHarness as never, { child: SelectTask, childProps: { appId: 'app', onselect: () => {}, open: true } } as never);
    mounted.push(m);
    return m;
  }

  it('one Escape inside the picker closes the picker, not the host dialog around it', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above); // registered before the picker opened
    let host: ReturnType<typeof openInHost>;
    try {
      host = openInHost();
      await tick(5);
      expect(overlay()).not.toBeNull();
      const input = overlay()!.querySelector('input');
      input!.focus(); // a real press starts at a control in the picker
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      flushSync();
      expect(overlay()).toBeNull(); // exactly one layer closed: the picker's
      expect(hostDialog()).not.toBeNull(); // the host keeps its layer
      expect(above).not.toHaveBeenCalled(); // the earlier-registered listener never fired
      expect((host.instance.hostEscapes as () => number)()).toBe(0); // the host's own window listener never fired
      // The positive control at this same position: the host's listener is
      // live — the NEXT press (nothing left to consume it) closes the host.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      flushSync();
      expect(hostDialog()).toBeNull();
      expect((host.instance.hostEscapes as () => number)()).toBe(1);
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('Escape with focus outside the picker still closes it — the fallback, shielding the host', async () => {
    const above = vi.fn();
    window.addEventListener('keydown', above);
    let host: ReturnType<typeof openInHost>;
    try {
      host = openInHost();
      await tick(5);
      (document.activeElement as HTMLElement | null)?.blur?.(); // focus never entered the picker
      expect(document.activeElement).toBe(document.body);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      flushSync();
      expect(overlay()).toBeNull();
      expect(hostDialog()).not.toBeNull();
      expect(above).not.toHaveBeenCalled();
      expect((host.instance.hostEscapes as () => number)()).toBe(0);
    } finally {
      window.removeEventListener('keydown', above);
    }
  });

  it('an Escape someone else already consumed, and one during IME composition, close nothing', async () => {
    // Mounted STANDALONE (no host harness): a legacy host's own window
    // listener may rightly react to a key even we refused — the guards'
    // contract is that the PICKER stays, and inside a host that closes
    // itself the picker would unmount with it for an unrelated reason.
    const consumer = (e: KeyboardEvent) => { if (e.key === 'Escape') e.preventDefault(); };
    window.addEventListener('keydown', consumer, true); // BEFORE the picker mounts
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer([choice()])));
      const m = mountComponent(SelectTask, { appId: 'app', open: true, onselect: () => {} });
      mounted.push(m);
      await tick(5);
      const input = m.target.querySelector('input')!;
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      flushSync();
      expect(m.target.querySelector('.fixed.inset-0')).not.toBeNull(); // consumed by another layer: not ours
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
      flushSync();
      expect(m.target.querySelector('.fixed.inset-0')).not.toBeNull(); // cancelling a composition, not the dialog
    } finally {
      window.removeEventListener('keydown', consumer, true);
    }
  });
});
