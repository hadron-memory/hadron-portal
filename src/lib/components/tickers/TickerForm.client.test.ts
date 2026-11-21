/**
 * portal#1151 (Tickers S7b) — the ticker form and the delete confirmation,
 * mounted: what a reader can choose, what a refusal leaves on screen, and that
 * nothing reports a write that did not land.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted, idleStatusAtMount } from '$lib/test/mountComponent';
import { beginEnhanced, submitEnhancedDeferred, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TickerForm from './TickerForm.svelte';
import TickerDelete from './TickerDelete.svelte';
import { announcedStatusRegion, firstPopulatedStatusText } from '$lib/test/firstPopulatedStatusText';

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
    expect(firstPopulatedStatusText(root)).toBeNull();
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
    const status = announcedStatusRegion(root)!.firstElementChild!;
    expect(status.textContent).toContain('Created standup.');
    expect(status.querySelector('a')?.getAttribute('href')).toBe('/app/apps/app-1/tickers/tk-9');
    expect(field(root, 'name').value).toBe('');
    expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
  });

  // portal#1463 — what a create does around a write that is still in flight or just refused.
  it('a create success keeps what was typed WHILE the request was in flight, and clears what it sent', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    type(field(root, 'name'), 'standup');
    type(field(root, 'cadenceSeconds'), '60');
    await tick(2);
    const deliver = await beginEnhanced(formOf(root));
    // The reader starts the next ticker's name while the first write is out.
    type(field(root, 'name'), 'standup-two');
    await tick(2);
    await deliver({ type: 'success', status: 200, data: { action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' } } });
    await tick(3);
    expect(field(root, 'name').value).toBe('standup-two');
    expect(field(root, 'cadenceSeconds').value).toBe('');
  });

  it('a new submit clears the previous refusal and its aria-invalid', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    type(field(root, 'name'), 'x');
    await tick(2);
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 400, data: { action: 'create', refusal: { kind: 'invalid', field: 'name', message: 'Name is taken.' } },
    });
    await tick(3);
    expect(root.querySelector('form [role="alert"]')).not.toBeNull();
    expect(field(root, 'name').getAttribute('aria-invalid')).toBe('true');
    await beginEnhanced(formOf(root)); // the next submit goes out; its answer has not come back
    await tick(3);
    expect(root.querySelector('form [role="alert"]')).toBeNull();
    expect(field(root, 'name').getAttribute('aria-invalid')).toBeNull();
  });

  it('an invalid refusal moves focus to the field it names; a whole-form one moves nothing', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 400, data: { action: 'create', refusal: { kind: 'invalid', field: 'cadenceSeconds', message: 'Too fast.' } },
    });
    await tick(3);
    expect(document.activeElement).toBe(field(root, 'cadenceSeconds'));
    (document.activeElement as HTMLElement).blur();
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 400, data: { action: 'create', refusal: { kind: 'invalid', field: 'form', message: 'No.' } },
    });
    await tick(3);
    expect(document.activeElement).toBe(document.body);
  });

  // portal#1384 acceptance 9: the warning a successful create carried (hadron-server#2733).
  const unmappedWarning = { code: 'ticker.code.unmapped', text: 'No task is mapped to this ticker’s code in the App’s register.' };

  it('a create that carried ticker.code.unmapped reports the ticker created AND shows the warning’s text and code beside the form', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    type(field(root, 'name'), 'standup');
    await tick(2);
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200,
      data: { action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' }, committedWithError: false, warnings: [unmappedWarning], more: 0 },
    });
    await tick(3);
    // The status line says warnings follow (for a screen reader), as a separate sentence.
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(firstPopulatedStatusText(root)).toContain('Created standup. 1 warning below.');
    const box = root.querySelector('[data-testid="task-warnings"]')!;
    expect(box.textContent).toContain(unmappedWarning.text);
    expect(box.querySelector('[data-warning-code="ticker.code.unmapped"] code')?.textContent).toBe('ticker.code.unmapped');
    expect(root.querySelector('form [role="alert"]')).toBeNull();
  });

  it('a create with no warnings shows no warnings box', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200,
      data: { action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' }, committedWithError: false, warnings: [], more: 0 },
    });
    await tick(3);
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(firstPopulatedStatusText(root)).toContain('Created standup.');
    expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
  });

  it('a committed create whose response also errored says so, keeps the warning and does not call it failed', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200,
      data: { action: 'create', ok: true, ticker: null, committedWithError: true, warnings: [unmappedWarning], more: 0 },
    });
    await tick(3);
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(firstPopulatedStatusText(root)).toContain('also reported an error');
    expect(root.querySelector('[data-testid="task-warnings"]')).not.toBeNull();
    expect(root.querySelector('a[href*="/tickers/"]')).toBeNull();
  });

  it('a committed create whose response also errored keeps its Open it link when the ticker came back', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200,
      data: { action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' }, committedWithError: true, warnings: [], more: 0 },
    });
    await tick(3);
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(firstPopulatedStatusText(root)).toContain('also reported an error');
    expect(root.querySelector('a[href="/app/apps/app-1/tickers/tk-9"]')).not.toBeNull();
  });

  it('a create that landed with no ticker returned (a warning proved it) says it was created, never the edit form’s “Saved”', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200,
      data: { action: 'create', ok: true, ticker: null, committedWithError: false, warnings: [unmappedWarning], more: 0 },
    });
    await tick(3);
    const text = firstPopulatedStatusText(root) ?? '';
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(text).toContain('Ticker created.');
    expect(text).not.toContain('Saved');
  });

  it('the next submit clears the previous create’s warning', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), {
      type: 'success', status: 200,
      data: { action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' }, committedWithError: false, warnings: [unmappedWarning], more: 0 },
    });
    await tick(3);
    expect(root.querySelector('[data-testid="task-warnings"]')).not.toBeNull();
    const { finish } = await submitEnhancedDeferred(formOf(root));
    await tick(2);
    expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
    // ...and it stays gone when the next create answers without a warning.
    await finish({ type: 'success', status: 200, data: { action: 'create', ok: true, ticker: { id: 'tk-10', name: 'next' }, committedWithError: false, warnings: [], more: 0 } });
    await tick(3);
    expect(root.querySelector('[data-testid="task-warnings"]')).toBeNull();
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(firstPopulatedStatusText(root)).toContain('Created next.');
  });

  it('an uncertain outcome says so, never "failed", and shows no success', async () => {
    const root = await mountIt(TickerForm, { appId: 'app-1', ticker: null });
    await submitEnhancedWithResult(formOf(root), { type: 'failure', status: 502, data: { action: 'create', refusal: { kind: 'uncertain' } } });
    await tick(3);
    expect(root.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(firstPopulatedStatusText(root)).toBeNull();
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
    expect(idleStatusAtMount(m.target), 'the region existed, empty, before the result').toContain(announcedStatusRegion(m.target));
    expect(firstPopulatedStatusText(m.target)).toContain('Saved');
  });

  // Gizelle's READ P2 on #1601: the draft typed during a pending update survives (the reader's newer
  // input), so the status must not claim the visible fields ARE the stored values.
  async function editWithDraftDuringRequest(typeDraft: boolean) {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', ticker: stored, impersonating: null });
    const m = mountComponent(TickerForm as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    type(field(m.target, 'name'), 'saved-name');
    await tick(2);
    const deliver = await beginEnhanced(formOf(m.target));
    if (typeDraft) {
      type(field(m.target, 'name'), 'unsaved-next-draft');
      await tick(2);
    }
    navigationHooks.onInvalidateAll = () => {
      props.ticker = { ...stored, name: 'saved-name' };
    };
    await deliver({ type: 'success', status: 200, data: { action: 'update', ok: true } });
    await tick(3);
    return m.target;
  }

  it('a success over a draft typed while it was pending keeps the draft and does NOT say the fields are the stored values', async () => {
    const root = await editWithDraftDuringRequest(true);
    expect(field(root, 'name').value).toBe('unsaved-next-draft');
    const status = firstPopulatedStatusText(root) ?? '';
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(status).toContain('Saved');
    expect(status).not.toContain('stored values');
    expect(status).toContain('not saved yet');
  });

  it('with no newer draft the success still says these are the stored values (control)', async () => {
    const root = await editWithDraftDuringRequest(false);
    expect(field(root, 'name').value).toBe('saved-name');
    expect(idleStatusAtMount(root), 'the region existed, empty, before the result').toContain(announcedStatusRegion(root));
    expect(firstPopulatedStatusText(root)).toContain('Saved. These are the stored values.');
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

  // portal#1463 — focus, refusal and the pending window of the confirmation.
  const deleteButton = (root: HTMLElement) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete…')!;
  const cancelButton = (root: HTMLElement) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!;

  it('opening the confirmation moves focus into it; Cancel returns focus to Delete…', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored });
    deleteButton(root).click();
    await tick(3);
    expect(formOf(root).contains(document.activeElement)).toBe(true);
    cancelButton(root).click();
    await tick(3);
    expect(document.activeElement).toBe(deleteButton(root));
  });

  it('Cancel clears a stale refusal', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored });
    deleteButton(root).click();
    await tick(2);
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 404, data: { action: 'delete', refusal: { kind: 'refused', code: 'TICKER_NOT_FOUND', message: 'Ticker not found.' } },
    });
    await tick(3);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    cancelButton(root).click();
    await tick(3);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it('a success keeps Delete disabled until the navigation to the list completes', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored });
    deleteButton(root).click();
    await tick(2);
    let arrive!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((r) => (arrive = r));
    const confirmButton = () => formOf(root).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const deliver = await beginEnhanced(formOf(root));
    const landed = deliver({ type: 'success', status: 200, data: { action: 'delete', ok: true } });
    await tick(3);
    expect(navigationCalls.some((c) => c.fn === 'goto')).toBe(true);
    // goto is still pending: a second click must not be possible.
    expect(confirmButton().disabled).toBe(true);
    arrive();
    await landed;
  });

  it('another ticker reseeds the confirmation: no open confirm, no refusal carried over', async () => {
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app-1', ticker: stored });
    const root = await mountIt(TickerDelete, props);
    deleteButton(root).click();
    await tick(2);
    await submitEnhancedWithResult(formOf(root), {
      type: 'failure', status: 404, data: { action: 'delete', refusal: { kind: 'refused', code: 'TICKER_NOT_FOUND', message: 'Ticker not found.' } },
    });
    await tick(3);
    expect(root.querySelector('form')).not.toBeNull();
    props.ticker = { id: 'tk-2', name: 'retro' };
    await tick(3);
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(deleteButton(root)).toBeDefined();
  });

  it('a support session gets no Delete', async () => {
    const root = await mountIt(TickerDelete, { appId: 'app-1', ticker: stored, impersonating: 'Rae' });
    expect(root.querySelector('button')).toBeNull();
  });
});

// Juliet's P2 on #1458: a result that lands after the reader left the page must touch nothing, and
// above all must not send them back to a list they navigated away from. The mounted tests above
// keep the positive control: while mounted, the same success does leave for the list / reload.
describe('a result that lands after the component is gone', () => {
  it('a delete success does not navigate the reader to the list', async () => {
    const m = mountComponent(TickerDelete as never, { appId: 'app-1', ticker: stored } as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    m.target.querySelector<HTMLButtonElement>('button')!.click();
    await tick(2);
    const { finish } = await submitEnhancedDeferred(formOf(m.target));
    m.unmount();
    await finish({ type: 'success', status: 200, data: { action: 'delete', ok: true } });
    await tick(3);
    expect(navigationCalls.filter((c) => c.fn === 'goto')).toHaveLength(0);
  });

  it('a form success does not reload or touch the page it left', async () => {
    const m = mountComponent(TickerForm as never, { appId: 'app-1', ticker: stored } as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    type(field(m.target, 'cadenceSeconds'), '300');
    await tick(2);
    const { finish } = await submitEnhancedDeferred(formOf(m.target));
    m.unmount();
    await finish({ type: 'success', status: 200, data: { action: 'update', ok: true } });
    await tick(3);
    expect(navigationCalls.filter((c) => c.fn === 'invalidateAll')).toHaveLength(0);
  });
});
