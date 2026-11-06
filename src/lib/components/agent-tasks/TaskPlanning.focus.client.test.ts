import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TaskPlanning from './TaskPlanning.svelte';

const mounts: { unmount: () => void }[] = [];
afterEach(() => { mounts.splice(0).forEach((m) => m.unmount()); vi.unstubAllGlobals(); });
const choice = (id: string) => ({ id, appId: 'app', title: `Task ${id}`, handle: `AT1.${id}`, status: 'PENDING' });
const initial = () => ({ kind: 'ok' as const, value: {
  blockedBy: { items: [choice('old-wait')], hasMore: true },
  blocks: { items: [choice('old-hold')], hasMore: true },
} });
async function setup() {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((r) => resolve = r)));
  const props = reactiveProps({ task: { id: 'task', appId: 'app', handle: 'AT1', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: true, dependencies: initial() });
  const m = mountComponent(TaskPlanning as never, props as never); mounts.push(m); await tick(3);
  const filter = m.target.querySelector<HTMLInputElement>('input[aria-label="Filter loaded relations…"]')!;
  const more = (name: string) => Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent === name)!;
  return { ...m, props, filter, more, fail: () => resolve({ ok: false } as Response), settle: (hasMore = false) => resolve({ ok: true, json: async () => ({ kind: 'ok', value: { items: [choice('new')], hasMore } }) } as Response) };
}
// jsdom does not synthesize native button activation from a key. Dispatch the key
// and its resulting click here; the real Chromium lane drives Enter/Space itself.
function activate(button: HTMLButtonElement, key: string) {
  button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); button.click();
}

function focusBody() {
  const previous = document.body.getAttribute('tabindex');
  document.body.tabIndex = -1; document.body.focus();
  if (previous === null) document.body.removeAttribute('tabindex');
  else document.body.setAttribute('tabindex', previous);
}

describe('exhausted relation control focus', () => {
  it.each(['Load more Waits for', 'Load more Holds up'].flatMap((name) => ['Enter', ' '].map((key) => [name, key])))('%s %s hands focus to the surviving filter after appending and exhausting', async (name, key) => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, key); await tick(3);
    m.settle(); await tick(12);
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(m.filter);
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(false);
    for (const title of ['Task old-wait', 'Task old-hold', 'Task new']) expect(m.target.textContent).toContain(title);
  });
  it.each(['Load more Waits for', 'Load more Holds up'])('%s ignores a platform body-focus event while the final page is pending', async (name) => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, 'Enter'); await tick(3);
    // Simulate the body-target focusin an engine may emit when the focused
    // trigger is disabled/removed. This is an event-order pin, not a claim
    // that a particular browser emits it (native coverage is Chromium).
    trigger.blur(); document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    m.settle(); await tick(12);
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(m.filter);
    expect(m.target.textContent).toContain('Task new');
  });
  it.each(['Load more Waits for', 'Load more Holds up'].flatMap(name => ['Enter', ' '].flatMap(key => ['heading', 'outside'].map(where => [name, key, where]))))('%s %s preserves newer blank pointer intent at %s during a final read', async (name, key, where) => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, key); await tick(3);
    const blank = where === 'heading' ? m.target.querySelector('h2')! : document.body;
    // A native blank click emits pointerdown but may not focus a new element.
    // A child stopping bubble propagation must not hide that newer attention.
    const stop = (event: Event) => event.stopPropagation(); blank.addEventListener('pointerdown', stop, { once: true });
    blank.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); focusBody();
    m.settle(); await tick(12);
    expect(trigger.isConnected).toBe(false); expect(document.activeElement).toBe(document.body);
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(true);
    expect(m.target.textContent).toContain('Task new'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['Load more Waits for', 'Load more Holds up'])('%s counts a blank pointer even if BODY was already active', async name => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, 'Enter'); await tick(3);
    trigger.blur(); expect(document.activeElement).toBe(document.body);
    m.target.querySelector('h2')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    m.settle(); await tick(12); expect(document.activeElement).toBe(document.body);
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(true);
  });
  it.each(['Load more Waits for', 'Load more Holds up'])('%s keeps the default handoff when a pointer repeats on the still-focused trigger', async name => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, 'Enter'); await tick(3);
    const child = document.createElement('span'); child.textContent = 'busy'; trigger.append(child);
    child.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); trigger.click();
    expect(fetch).toHaveBeenCalledTimes(1); m.settle(); await tick(12);
    expect(document.activeElement).toBe(m.filter); expect(trigger.isConnected).toBe(false);
  });
  it('does not reveal the filter for an activation that never owned focus', async () => {
    const m = await setup(); m.more('Load more Waits for').click(); await tick(3);
    m.settle(); await tick(12);
    expect(m.target.textContent).toContain('Task new');
    expect(document.activeElement).toBe(document.body);
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(true);
  });
  it('targets the named filter even if a different input precedes it in the table', async () => {
    const m = await setup(); const other = document.createElement('input'); other.type = 'checkbox';
    m.filter.closest('[data-testid="table-frame"]')!.prepend(other);
    activate(m.more('Load more Waits for'), 'Enter'); await tick(3); m.settle(); await tick(12);
    expect(document.activeElement).toBe(m.filter);
  });
  it('hands off to the filter when its header was already open', async () => {
    const m = await setup(); m.target.querySelector<HTMLButtonElement>('[data-testid="table-header-toggle"]')!.click(); await tick(3);
    activate(m.more('Load more Holds up'), 'Enter'); await tick(3); m.settle(); await tick(12);
    expect(document.activeElement).toBe(m.filter);
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(false);
  });
  it('preserves a newer focus, even if that newer target is subsequently blurred to body', async () => {
    const m = await setup(); activate(m.more('Load more Waits for'), 'Enter'); await tick(3);
    const newer = m.more('Choose a task'); newer.focus(); newer.blur();
    m.settle(); await tick(12);
    expect(document.activeElement).toBe(document.body);
    expect(m.target.textContent).toContain('Task new');
  });
  it('keeps a newer surviving control focused while the final page arrives', async () => {
    const m = await setup(); activate(m.more('Load more Holds up'), ' '); await tick(3);
    const newer = m.more('Choose a task'); newer.focus(); m.settle(); await tick(12);
    expect(document.activeElement).toBe(newer);
    expect(m.target.textContent).toContain('Task new');
  });
  it('does not hand focus off on a short non-final page', async () => {
    const m = await setup(); const trigger = m.more('Load more Waits for'); activate(trigger, 'Enter'); await tick(3);
    m.settle(true); await tick(12);
    expect(trigger.isConnected).toBe(true); expect(document.activeElement).not.toBe(m.filter);
    expect(m.target.textContent).toContain('Task new');
  });
  it.each(['Load more Waits for', 'Load more Holds up'].flatMap(name => ['Enter', ' '].map(key => [name, key])))('%s %s stays focusable while paging and suppresses repeated activation', async (name, key) => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, key); await tick(3);
    expect(trigger.disabled).toBe(false); expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.getAttribute('aria-busy')).toBe('true'); expect(document.activeElement).toBe(trigger);
    trigger.click(); trigger.click(); expect(fetch).toHaveBeenCalledTimes(1);
    m.settle(true); await tick(12);
    expect(trigger.isConnected).toBe(true); expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-busy')).toBe('false'); expect(document.activeElement).toBe(trigger);
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(true);
  });
  it.each(['Load more Waits for', 'Load more Holds up'])('%s does not reclaim BODY after a newer click on blank space', async name => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, 'Enter'); await tick(3);
    // Chromium clicking a non-focusable heading leaves BODY; no focusin on a
    // different control occurs. Native reproduction is kept separate.
    focusBody(); m.settle(true); await tick(12); expect(document.activeElement).toBe(document.body);
  });
  it.each([false, true])('does not reclaim a non-final control after newer focus (blur=%s)', async blur => {
    const m = await setup(); const trigger = m.more('Load more Waits for'); activate(trigger, 'Enter'); await tick(3);
    focusBody(); const newer = m.more('Choose a task'); newer.focus(); if (blur) newer.blur();
    m.settle(true); await tick(12);
    expect(document.activeElement).toBe(blur ? document.body : newer);
  });
  it('does not claim a surviving non-final control when activation never owned focus', async () => {
    const m = await setup(); m.more('Load more Waits for').click(); await tick(3);
    m.settle(true); await tick(12); expect(document.activeElement).toBe(document.body);
  });
  it('keeps the retryable control focused after a failed read without moving to the final-page filter', async () => {
    const m = await setup(); const trigger = m.more('Load more Holds up'); activate(trigger, 'Enter'); await tick(3);
    m.fail(); await tick(12); expect(document.activeElement).toBe(trigger); expect(trigger.disabled).toBe(false);
    expect(m.target.textContent).toContain('Couldn’t load more Holds up. Try again.');
    expect(m.filter.closest<HTMLElement>('[data-testid="table-header"]')?.hidden).toBe(true);
  });
  it('does not restore a non-final control across a newer relation snapshot', async () => {
    const m = await setup(); const trigger = m.more('Load more Waits for'); activate(trigger, 'Enter'); await tick(3); focusBody();
    m.props.dependencies = initial(); await tick(3); m.settle(true); await tick(12);
    expect(document.activeElement).toBe(document.body); expect(m.target.textContent).not.toContain('Task new');
  });
  it('does not focus a new task after a pending page is invalidated', async () => {
    const m = await setup(); activate(m.more('Load more Waits for'), 'Enter'); await tick(3);
    m.props.task = { ...m.props.task, id: 'B' }; m.props.dependencies = initial(); await tick(3);
    const newer = m.more('Choose a task'); newer.focus(); m.settle(); await tick(12);
    expect(document.activeElement).toBe(newer); expect(m.target.textContent).not.toContain('Task new');
  });
  it.each([false, true])('does not run a pending focus handoff after unmount (hasMore=%s)', async hasMore => {
    const m = await setup(); activate(m.more('Load more Waits for'), 'Enter'); await tick(3); m.unmount();
    m.settle(hasMore); await tick(12); expect(document.activeElement).toBe(document.body);
  });
});
