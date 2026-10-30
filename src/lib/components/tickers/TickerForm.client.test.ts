/**
 * portal#1151 (Tickers S7b) — the ticker form and the delete confirmation,
 * mounted: what a reader can choose, what a refusal leaves on screen, and that
 * nothing reports a write that did not land.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TickerForm from './TickerForm.svelte';
import TickerDelete from './TickerDelete.svelte';

const stored = { id: 'tk-1', name: 'standup', cadenceSeconds: 600, reasons: ['READ_TEAM_CHANNEL'] };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});

async function mountIt(component: unknown, props: Record<string, unknown>) {
  const m = mountComponent(component as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
const field = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const reason = (root: HTMLElement, r: string) => root.querySelector<HTMLInputElement>(`input[name="reasons"][value="${r}"]`)!;
function type(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function check(el: HTMLInputElement, on: boolean) {
  el.checked = on;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
const formOf = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form')!;
const sent = (root: HTMLElement) => {
  const fd = new FormData(formOf(root));
  return { reasons: fd.getAll('reasons'), name: fd.get('name'), cadence: fd.get('cadenceSeconds') };
};

describe('TickerForm (create)', () => {
  it('starts with Team chat chosen and posts the choice as a real form value', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null, impersonating: null });
    expect(formOf(root).getAttribute('action')).toBe('?/create');
    expect(sent(root).reasons).toEqual(['READ_TEAM_CHANNEL']);
    check(reason(root, 'EVERY_TICK'), true);
    await tick(2);
    expect(sent(root).reasons).toEqual(['READ_TEAM_CHANNEL', 'EVERY_TICK']);
    check(reason(root, 'READ_TEAM_CHANNEL'), false);
    await tick(2);
    expect(sent(root).reasons).toEqual(['EVERY_TICK']);
  });

  it('reads the cadence back in words beside the field', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    type(field(root, 'cadenceSeconds'), '600');
    await tick(2);
    expect(root.textContent).toContain('Reads as every 10 min.');
  });

  it('a refusal keeps what was typed, shows the sentence and the code, and reports no success', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    type(field(root, 'name'), 'standup');
    type(field(root, 'cadenceSeconds'), '60');
    await tick(2);
    const message = 'This App has reached its ticker limit (20).';
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 409, data: { action: 'create', refusal: { kind: 'refused', code: 'TICKER_LIMIT_REACHED', message } },
    });
    await tick(3);
    expect(root.querySelector('form [role="alert"]')?.textContent).toContain(`“${message}”`);
    expect(root.querySelector('form [role="alert"]')?.textContent).toContain('TICKER_LIMIT_REACHED');
    expect(field(root, 'name').value).toBe('standup');
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });

  it('a success says what was created, links to it, and resets the form', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    type(field(root, 'name'), 'standup');
    await tick(2);
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200, data: { action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' } },
    });
    await tick(3);
    const status = root.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Created standup.');
    expect(status.querySelector('a')?.getAttribute('href')).toBe('/app/apps/app-1/tickers/tk-9');
    expect(field(root, 'name').value).toBe('');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
  });

  it('an uncertain outcome says so, never "failed", and shows no success', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), { type: 'failure', status: 502, data: { action: 'create', refusal: { kind: 'uncertain' } } });
    await tick(3);
    expect(root.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('the consent refusal renders the portal’s sentence, which names neither reason alone', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: stored });
    check(reason(root, 'LIVE_CHECK'), true);
    await tick(2);
    const message = 'This change could wake a subscriber more often … Adding Every tick or Live check is checked this way.';
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 409, data: { action: 'update', refusal: { kind: 'refused', code: 'TICKER_CADENCE_NEEDS_CONSENT', message } },
    });
    await tick(3);
    const text = root.querySelector('form [role="alert"]')!.textContent!;
    expect(text).toContain('Every tick or Live check');
    expect(reason(root, 'LIVE_CHECK').checked).toBe(true);
  });
});

describe('TickerForm (edit)', () => {
  it('shows the stored values and the Was fields the update diffs against', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: stored });
    expect(formOf(root).getAttribute('action')).toBe('?/update');
    expect(field(root, 'name').value).toBe('standup');
    expect(field(root, 'nameWas').value).toBe('standup');
    expect(field(root, 'cadenceSecondsWas').value).toBe('600');
    expect(field(root, 'reasonsWas').value).toBe('READ_TEAM_CHANNEL');
    expect(field(root, 'reasonsShown').value).toBe('1');
    expect(root.querySelector('button[type="submit"]')?.textContent).toContain('Save');
  });

  it('a success shows the STORED values from the re-read, not the typed ones', async () => {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', ticker: stored, impersonating: null });
    const m = mountComponent(TickerForm as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    type(field(m.target, 'cadenceSeconds'), '300');
    await tick(2);
    await submitEnhancedWithResult(formOf(m.target), { type: 'success', status: 200, data: { action: 'update', ok: true } });
    props.ticker = { ...stored, cadenceSeconds: 301 };
    await tick(3);
    expect(field(m.target, 'cadenceSeconds').value).toBe('301');
    expect(m.target.querySelector('[role="status"]')?.textContent).toContain('Saved');
  });

  it('another ticker reseeds: nothing typed for the first survives', async () => {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', ticker: stored, impersonating: null });
    const m = mountComponent(TickerForm as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    type(field(m.target, 'name'), 'typed');
    await tick(2);
    props.ticker = { id: 'tk-2', name: 'other', cadenceSeconds: 120, reasons: ['EVERY_TICK'] };
    await tick(3);
    expect(field(m.target, 'name').value).toBe('other');
    expect(reason(m.target, 'EVERY_TICK').checked).toBe(true);
  });

  it('a support session gets no form', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: stored, impersonating: 'Rae' });
    expect(root.querySelector('form')).toBeNull();
  });
});

describe('TickerDelete', () => {
  it('asks first: the consequence sits with the confirmation, and nothing is posted until it is confirmed', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored });
    expect(root.querySelector('form')).toBeNull();
    root.querySelector<HTMLButtonElement>('button')!.click();
    await tick(2);
    expect(formOf(root).getAttribute('action')).toBe('?/delete');
    expect(root.textContent).toContain('Delete standup? Its subscriptions end');
    root.querySelectorAll<HTMLButtonElement>('button[type="button"]')[0].click();
    await tick(2);
    expect(root.querySelector('form')).toBeNull();
  });

  it('a stale control: the server’s refusal is shown and the page stays', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored });
    root.querySelector<HTMLButtonElement>('button')!.click();
    await tick(2);
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 404, data: { action: 'delete', refusal: { kind: 'refused', code: 'TICKER_NOT_FOUND', message: 'Ticker not found.' } },
    });
    await tick(3);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('TICKER_NOT_FOUND');
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(0);
  });

  it('a success leaves for the list instead of reloading the deleted ticker', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored });
    root.querySelector<HTMLButtonElement>('button')!.click();
    await tick(2);
    await submitEnhancedWithResult(formOf(root), { type: 'success', status: 200, data: { action: 'delete', ok: true } });
    await tick(3);
    expect(navigationCalls.find((c) => c.fn === 'goto')?.args[0]).toBe('/app/apps/app-1/tickers');
  });

  it('a support session gets no Delete', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored, impersonating: 'Rae' });
    expect(root.querySelector('button')).toBeNull();
  });
});
