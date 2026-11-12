/**
 * portal#1701 — the new-schedule page in a real DOM: Create is on only while the server's answer for what is on
 * screen NOW is "adoptable". Any change turns it off before the question goes out, and a late answer to an
 * earlier question never turns it back on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), applyAction: vi.fn(), deserialize: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

const READY = { state: 'ready', summary: { reads: ['Reads the digest memory.'], writes: [], tools: ['hadron_find_nodes'], limits: [], cannotDo: ['Never reads a private memory.'] } };
let mounted: Mounted<Record<string, unknown>> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // not Intl: the zone is stubbed below
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Europe/Berlin' } as never);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { mounted?.unmount(); mounted = null; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function show() {
  const m = mountComponent(Page as never, { data: { app: { id: 'app-1', name: 'Team', organizationId: null }, nodeMemories: { kind: 'ok', value: [] } }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted = m;
  await vi.advanceTimersByTimeAsync(0);
  return m.target;
}
const create = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const panel = (t: HTMLElement) => t.querySelector('[data-testid="schedule-preview"]')!;
async function settle(ms = 300) { await vi.advanceTimersByTimeAsync(ms); flushSync(); }
function edit(t: HTMLElement) {
  const time = t.querySelector<HTMLInputElement>('input[name="time"]')!;
  time.value = '10:00';
  time.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('new schedule: Create follows the preview', () => {
  it('starts off, asks with the browser zone, and turns on only for ADOPTABLE', async () => {
    fetchMock.mockImplementation(() => reply(READY));
    const t = await show();
    expect(create(t).disabled).toBe(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/app/apps/app-1/automations/new-schedule/preview');
    expect((fetchMock.mock.calls[0][1].body as FormData).get('zone')).toBe('Europe/Berlin');
    expect(panel(t).getAttribute('data-state')).toBe('ready');
    expect(panel(t).textContent).toContain('Reads the digest memory.');
    expect(create(t).disabled).toBe(false);
  });
  it('turns Create off at once on a change, before the answer, and on again only with the new answer', async () => {
    fetchMock.mockImplementation(() => reply(READY));
    const t = await show();
    await settle();
    edit(t);
    expect(create(t).disabled).toBe(true);
    expect(panel(t).getAttribute('data-state')).toBe('loading');
    await settle();
    expect(create(t).disabled).toBe(false);
  });
  it('a late answer to an earlier question never turns Create on', async () => {
    let first!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { first = r; }));
    fetchMock.mockImplementation(() => reply({ state: 'blocked', message: 'Choose something else.' }));
    const t = await show();
    await settle(); // first question in flight
    edit(t);
    await settle(); // second question answered: blocked
    first({ ok: true, json: async () => READY });
    await settle(0);
    expect(panel(t).getAttribute('data-state')).toBe('blocked');
    expect(create(t).disabled).toBe(true);
  });
  it.each([
    ['blocked', { state: 'blocked', message: 'Something this would read cannot be read.' }],
    ['refused', { state: 'refused', message: 'Only an organization admin can create a schedule.' }],
    ['incomplete', { state: 'incomplete' }],
  ])('%s keeps Create off', async (state, body) => {
    fetchMock.mockImplementation(() => reply(body));
    const t = await show();
    await settle();
    expect(panel(t).getAttribute('data-state')).toBe(state);
    expect(create(t).disabled).toBe(true);
    if ('message' in body) expect(panel(t).textContent).toContain(body.message);
  });
  it('a failed check keeps Create off and says so, with no blank summary', async () => {
    fetchMock.mockImplementation(() => reply({}, false));
    const t = await show();
    await settle();
    expect(panel(t).getAttribute('data-state')).toBe('failed');
    expect(create(t).disabled).toBe(true);
    expect(panel(t).textContent).toContain('could not check');
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    edit(t);
    await settle();
    expect(panel(t).getAttribute('data-state')).toBe('failed');
  });
  it('a pending question is dropped on teardown: no state written after unmount', async () => {
    let late!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((r) => { late = r; }));
    const t = await show();
    await settle();
    mounted!.unmount();
    mounted = null;
    late({ ok: true, json: async () => READY });
    await settle(0);
    expect(t.isConnected).toBe(false);
  });
});

describe('new schedule: a ready answer belongs to its App (LOCAL P2-2)', () => {
  it('turns Create off when the page is reused for another App, and needs that App’s own answer', async () => {
    fetchMock.mockImplementation(() => reply(READY));
    const props = reactiveProps<Record<string, unknown>>({ data: { app: { id: 'app-1', name: 'Team', organizationId: null }, nodeMemories: { kind: 'ok', value: [] } }, form: null });
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await vi.advanceTimersByTimeAsync(0);
    const t = mounted.target;
    await settle();
    expect(create(t).disabled).toBe(false);
    fetchMock.mockClear();
    let release!: (v: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    props.data = { app: { id: 'app-2', name: 'Other', organizationId: null }, nodeMemories: { kind: 'ok', value: [] } };
    flushSync();
    expect(create(t).disabled).toBe(true);
    await settle();
    expect(fetchMock.mock.calls[0][0]).toBe('/app/apps/app-2/automations/new-schedule/preview');
    expect(create(t).disabled).toBe(true);
    release({ ok: true, json: async () => READY } as Response);
    await settle(0);
    expect(create(t).disabled).toBe(false);
  });
});
