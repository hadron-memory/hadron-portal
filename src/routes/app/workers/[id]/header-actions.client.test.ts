/**
 * portal#2205 — the worker page header's ⋮ menu (Retire, Delete) and the
 * retire outcome banner. Client lane on purpose: the menu's trigger, its
 * confirm-gated submit and the dialog mount all live in the component
 * lifecycle a server render never mounts (#795).
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';

function worker(over: Partial<Record<string, unknown>> = {}) {
  return {
    hasLiveSession: false,
    id: 'w-a',
    appId: 'app-1',
    agentId: 'agent-1',
    name: 'Ada',
    slug: 'ada',
    urn: 'hrn:worker:hadronmemory.com:team:w-a',
    role: 'engineer',
    prompt: 'BOUND TEMPLATE',
    memoryId: null,
    retiredAt: null,
    leaveAlone: null,
    leaveAloneReason: null,
    leaveAloneBy: null,
    leaveAloneAt: null,
    heldByUserId: null,
    heldAt: null,
    createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
    ...over,
  };
}

function dataFor(workerFixture: ReturnType<typeof worker>, over: Record<string, unknown> = {}) {
  return {
    worker: workerFixture,
    initialTab: 'profile',
    initialView: 'rendered',
    workerSessions: [],
    sessionsTruncated: false,
    worklog: [],
    worklogTotal: 0,
    canManageWorkerApp: true,
    impersonation: false,
    canChangeAgent: false,
    // The loader always supplies the key the retire action keys with: the
    // route's params.id spelling, which may be the worker's URN.
    retireKey: 'w-a',
    ...over,
  };
}

// jsdom has no <dialog> semantics; stub what showModal/close touch, exactly as
// WorkerDeleteDialog.client.test.ts does.
let oldShow: PropertyDescriptor | undefined, oldClose: PropertyDescriptor | undefined;
beforeAll(() => {
  oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterAll(() => {
  for (const [name, old] of [['showModal', oldShow], ['close', oldClose]] as const) {
    if (old) Object.defineProperty(HTMLDialogElement.prototype, name, old);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

beforeEach(() => {
  resetNavigationGuards();
  resetNavigationCalls();
  setStubPage('http://localhost/app/workers/w-a?tab=profile', { id: 'w-a' });
});

const menuButton = (target: HTMLElement) =>
  [...target.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Actions for Ada') ?? null;

function openMenu(target: HTMLElement) {
  menuButton(target)!.click();
  flushSync();
}

const menuItems = (target: HTMLElement) =>
  [...target.querySelectorAll('[role="menuitem"]')].map(el => el.textContent?.trim());

it('a manager acting as themselves sees the header menu with both destructive items', () => {
  const mounted = mountComponent(Page, { data: dataFor(worker()), form: null } as never);
  try {
    flushSync();
    expect(menuButton(mounted.target)).not.toBeNull();
    openMenu(mounted.target);
    expect(menuItems(mounted.target)).toEqual(['Retire', 'Delete verified-unused worker']);
  } finally { mounted.unmount(); }
});

it('a retired worker keeps Delete (the law admits deleting a just-retired worker) but drops Retire', () => {
  const mounted = mountComponent(Page, { data: dataFor(worker({ retiredAt: '2026-11-17T00:00:00Z' })), form: null } as never);
  try {
    flushSync();
    openMenu(mounted.target);
    expect(menuItems(mounted.target)).toEqual(['Delete verified-unused worker']);
  } finally { mounted.unmount(); }
});

it.each([
  ['a non-manager', { canManageWorkerApp: false }],
  ['an impersonated session', { impersonation: true }],
])('hides the menu from %s — display only; the server gate is the gate', (_name, over) => {
  const mounted = mountComponent(Page, { data: dataFor(worker(), over as Record<string, unknown>), form: null } as never);
  try {
    flushSync();
    expect(menuButton(mounted.target)).toBeNull();
    expect(mounted.target.querySelector('[role="menu"]')).toBeNull();
  } finally { mounted.unmount(); }
});

it('retire submits only after the confirm states permanence and is accepted, on the current tab', () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const mounted = mountComponent(Page, { data: dataFor(worker()), form: null } as never);
  try {
    flushSync();
    openMenu(mounted.target);
    const submitted: string[] = [];
    mounted.target.addEventListener('submit', (e) => { e.preventDefault(); submitted.push((e.target as HTMLFormElement).getAttribute('action') ?? ''); });
    ([...mounted.target.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.trim() === 'Retire') as HTMLElement).click();
    flushSync();
    // Declined confirm: no submit, and the prompt names the consequences a
    // manager cannot undo (permanence + tickers/subscriptions/grants ending).
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('no undo');
    expect(confirmSpy.mock.calls[0][0]).toContain('held grants end');
    expect(confirmSpy.mock.calls[0][0]).toContain('Ada');
    expect(submitted).toEqual([]);
    confirmSpy.mockReturnValue(true);
    openMenu(mounted.target);
    ([...mounted.target.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.trim() === 'Retire') as HTMLElement).click();
    flushSync();
    expect(submitted).toEqual(['?tab=profile&/retireWorker']);
  } finally {
    confirmSpy.mockRestore();
    mounted.unmount();
  }
});

it('delete opens the roster’s shared dialog with an unchecked attestation', () => {
  const mounted = mountComponent(Page, { data: dataFor(worker()), form: null } as never);
  try {
    flushSync();
    expect(mounted.target.querySelector('dialog[aria-labelledby="delete-worker-title"]')).toBeNull();
    openMenu(mounted.target);
    ([...mounted.target.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.trim() === 'Delete verified-unused worker') as HTMLElement).click();
    flushSync();
    const dialog = mounted.target.querySelector<HTMLDialogElement>('dialog[aria-labelledby="delete-worker-title"]');
    expect(dialog).not.toBeNull();
    const box = dialog!.querySelector<HTMLInputElement>('input[type=checkbox]');
    expect(box?.checked).toBe(false);
    const form = dialog!.querySelector('form')!;
    expect(form.getAttribute('action')).toBe('?/deleteWorker');
    expect(form.querySelector('input[name="workerRef"]')?.getAttribute('value')).toBe('w-a');
  } finally { mounted.unmount(); }
});

it('shows the retire banner only for a result keyed to this worker', () => {
  const foreign = mountComponent(Page, { data: dataFor(worker()), form: { retireResult: { key: 'w-b', ok: true, message: 'Another worker’s reply.' } } } as never);
  try {
    flushSync();
    const statuses = [...foreign.target.querySelectorAll('[role="status"], [role="alert"]')].map(el => el.textContent ?? '').join('');
    expect(statuses).not.toContain('Another worker’s reply.');
  } finally { foreign.unmount(); }

  const ok = mountComponent(Page, { data: dataFor(worker()), form: { retireResult: { key: 'w-a', ok: true, message: 'Worker retired. Its name stays reserved.' } } } as never);
  try {
    flushSync();
    expect(ok.target.querySelector('[role="status"]')?.textContent).toContain('Worker retired. Its name stays reserved.');
  } finally { ok.unmount(); }

  const refused = mountComponent(Page, { data: dataFor(worker()), form: { retireResult: { key: 'w-a', ok: false, message: 'You don’t have permission to staff this App.' } } } as never);
  try {
    flushSync();
    expect(refused.target.querySelector('[role="alert"]')?.textContent).toContain('You don’t have permission to staff this App.');
  } finally { refused.unmount(); }

  // The key the ACTION uses is the route's params.id spelling, which may be
  // the worker's URN while worker.id stays the canonical id — the same rule
  // as changeAgentKey. Keying by worker.id would drop the banner on every
  // URN-spelled visit to this page.
  const urnSpelled = mountComponent(Page, {
    data: dataFor(worker(), { retireKey: 'hrn:worker:hadronmemory.com:team:w-a' }),
    form: { retireResult: { key: 'hrn:worker:hadronmemory.com:team:w-a', ok: true, message: 'Worker retired. Its name stays reserved.' } },
  } as never);
  try {
    flushSync();
    expect(urnSpelled.target.querySelector('[role="status"]')?.textContent).toContain('Worker retired. Its name stays reserved.');
  } finally { urnSpelled.unmount(); }
});
