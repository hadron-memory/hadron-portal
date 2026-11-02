/**
 * portal#1609 (slice C of #1141) — the Agent's ticker templates, mounted: who
 * is offered controls (only `viewerMayEditTickerTemplates === true`), what an
 * edit and a delete carry (the revision the page read), and what a refusal,
 * a stale revision, a success and a late result do. Nothing is optimistic and
 * nothing is retried: stored values change only when the page re-reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { beginEnhanced, submitEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Panel from './AgentTickerTemplatesPanel.svelte';

const quiet = { timezone: 'Europe/Berlin', windows: [{ days: [6, 7], from: '22:00', to: '08:00' }] };
const standup = { id: 'tpl-1', name: 'standup', cadenceSeconds: 600, quietHours: null, reasons: ['READ_TEAM_CHANNEL'], relevance: 'ALL', revision: 4, tickCode: 'standup', updatedAt: null };
const nightly = { id: 'tpl-2', name: 'nightly', cadenceSeconds: 3600, quietHours: quiet, reasons: ['EVERY_TICK'], relevance: 'ALL', revision: 9, tickCode: 'tk-ünknown-7', updatedAt: null };
const odd = { id: 'tpl-3', name: 'odd', cadenceSeconds: 60, quietHours: null, reasons: ['FUTURE_REASON'], relevance: 'ALL', revision: 1, tickCode: 'odd', updatedAt: null };

const ok = (viewerMayEdit: boolean | null, templates: unknown[] = [standup, nightly]) => ({ kind: 'ok' as const, value: { viewerMayEdit, templates } });

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
});

async function mountPanel(props: Record<string, unknown> = {}) {
  const m = mountComponent(Panel as never, { agentId: 'agent-1', templates: ok(true), impersonating: null, ...props } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
async function mountReactive(over: Record<string, unknown> = {}) {
  const props = reactiveProps<Record<string, unknown>>({ agentId: 'agent-1', templates: ok(true), impersonating: null, ...over });
  const m = mountComponent(Panel as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return { props, root: m.target };
}

const field = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const createForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/createTickerTemplate"]');
const updateForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/updateTickerTemplate"]')!;
function type(el: HTMLInputElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function openEdit(root: HTMLElement, name: string) {
  root.querySelector<HTMLButtonElement>(`button[aria-label="Edit ${name}"]`)!.click();
  await tick(3);
}
const invalidations = () => navigationCalls.filter((c) => c.fn === 'invalidateAll').length;

describe('who is offered controls', () => {
  it('capability true: the list and the add form', async () => {
    const root = await mountPanel();
    expect(root.textContent).toContain('standup');
    expect(root.textContent).toContain('nightly');
    expect(createForm(root)).not.toBeNull();
    expect(root.querySelector('button[aria-label="Edit standup"]')).not.toBeNull();
  });

  it('capability false or null: the list alone, no controls and no invented error', async () => {
    for (const cap of [false, null]) {
      const root = await mountPanel({ templates: ok(cap) });
      expect(root.textContent).toContain('standup');
      expect(root.querySelector('form')).toBeNull();
      // The DataTable's own chrome has buttons; none of them is a template control.
      expect(root.querySelector('button[aria-label^="Edit"]')).toBeNull();
      expect([...root.querySelectorAll('button')].some((b) => /^(Add|Save|Delete)/.test(b.textContent?.trim() ?? ''))).toBe(false);
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(root.textContent).not.toMatch(/can’t|not allowed|forbidden|permission/i);
    }
  });

  it('a support session sees the list and a switched-off note, no controls', async () => {
    const root = await mountPanel({ impersonating: 'Rae' });
    expect(root.textContent).toContain('standup');
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).toContain('Viewing as Rae');
  });

  it('a failed read says so and lists nothing (never an empty list)', async () => {
    const root = await mountPanel({ templates: { kind: 'failed' } });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('[data-testid="agent-ticker-templates-empty"]')).toBeNull();
  });

  it('no templates: an honest empty state, and the add form for an editor', async () => {
    const root = await mountPanel({ templates: ok(true, []) });
    expect(root.querySelector('[data-testid="agent-ticker-templates-empty"]')).not.toBeNull();
    expect(createForm(root)).not.toBeNull();
  });
});

describe('what the page shows', () => {
  it('shows the tick code exactly as the server sent it, unknown codes included, and says edits reach only future casts', async () => {
    const root = await mountPanel({ templates: ok(false) });
    expect(root.textContent).toContain('tk-ünknown-7');
    expect(root.textContent).toContain('reaches only workers cast afterwards');
  });

  it('an editor’s form repeats the future-casts-only line beside the action', async () => {
    const root = await mountPanel();
    expect(createForm(root)!.textContent).toContain('Changes reach only workers cast from this Agent afterwards');
  });
});

describe('the edit form', () => {
  it('carries the template id and the revision the page read, and the stored values', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    const f = updateForm(root);
    expect(f.querySelector<HTMLInputElement>('input[name="id"]')!.value).toBe('tpl-2');
    expect(f.querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('9');
    expect(field(f as never, 'name').value).toBe('nightly');
    expect(field(f as never, 'cadenceSeconds').value).toBe('3600');
    expect(createForm(root)).toBeNull();
    expect(root.querySelector(`[data-testid="agent-template-delete-tpl-2"]`)).not.toBeNull();
  });

  it('offers removing quiet hours only for a template that has some', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    expect(updateForm(root).querySelector('input[name="clearQuietHours"]')).toBeNull();
    await openEdit(root, 'nightly');
    const box = updateForm(root).querySelector<HTMLInputElement>('input[name="clearQuietHours"]')!;
    expect(box).not.toBeNull();
    expect(box.value).toBe('1');
    expect(box.checked).toBe(false);
    expect(updateForm(root).textContent).toContain('Europe/Berlin');
  });

  it('a template with a reason this build can’t show keeps its reasons: none are offered or sent', async () => {
    const root = await mountPanel({ templates: ok(true, [odd]) });
    await openEdit(root, 'odd');
    const f = updateForm(root);
    expect(f.querySelector('input[name="reasons"]')).toBeNull();
    expect(f.querySelector('input[name="reasonsShown"]')).toBeNull();
    expect(f.textContent).toContain('reasons are left as they are');
  });

  it('typed text survives an unrelated re-render of the stored values', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    props.templates = ok(true);
    await tick(3);
    expect(field(updateForm(root) as never, 'name').value).toBe('daily');
  });

  it('the submit is disabled while a save is in flight', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    expect(updateForm(root).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    await submitEnhanced(updateForm(root));
    await tick(2);
    expect(updateForm(root).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});

describe('outcomes', () => {
  it('a refusal keeps what was typed, shows the sentence and code, and does not reload', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'nightly');
    await tick(2);
    const message = 'A template named nightly already exists.';
    await submitEnhancedWithResult(updateForm(root), {
      type: 'failure', status: 400, data: { action: 'updateTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_NAME_TAKEN', message } },
    });
    await tick(3);
    const alert = updateForm(root).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(`“${message}”`);
    expect(alert?.textContent).toContain('TICKER_TEMPLATE_NAME_TAKEN');
    expect(field(updateForm(root) as never, 'name').value).toBe('nightly');
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(invalidations()).toBe(0);
  });

  it('a stale revision keeps the draft, does NOT retry or reload by itself, and offers an explicit reload', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), {
      type: 'failure', status: 409, data: { action: 'updateTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH', message: 'changed by someone else' } },
    });
    await tick(3);
    expect(field(updateForm(root) as never, 'name').value).toBe('daily');
    expect(invalidations()).toBe(0);
    const reload = [...updateForm(root).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reload latest')!;
    expect(reload).toBeDefined();
    reload.click();
    await tick(3);
    expect(invalidations()).toBe(1);
  });

  it('an ordinary refusal offers no reload button', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), {
      type: 'failure', status: 403, data: { action: 'updateTickerTemplate', refusal: { kind: 'refused', code: 'FORBIDDEN', message: 'x' } },
    });
    await tick(3);
    expect([...updateForm(root).querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Reload latest')).toBe(false);
  });

  it('an uncertain outcome shows the fixed line, not "failed", and no success', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), { type: 'failure', status: 502, data: { action: 'updateTickerTemplate', refusal: { kind: 'uncertain' } } });
    await tick(3);
    expect(root.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('a success reloads, then shows the STORED values from the re-read, not the typed ones, and focuses the status', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    updateForm(root).querySelector<HTMLButtonElement>('button[type="submit"]')!.focus(); // a real Save click leaves focus here
    await submitEnhancedWithResult(updateForm(root), { type: 'success', status: 200, data: { action: 'updateTickerTemplate', ok: true } });
    props.templates = ok(true, [{ ...standup, name: 'daily-stored', revision: 5 }, nightly]);
    await tick(3);
    flushSync();
    expect(invalidations()).toBeGreaterThan(0);
    expect(field(updateForm(root) as never, 'name').value).toBe('daily-stored');
    expect(updateForm(root).querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('5');
    const status = root.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Saved');
    expect(document.activeElement).toBe(status);
  });

  it('an added template says it reaches workers cast from now on', async () => {
    const root = await mountPanel();
    await submitEnhancedWithResult(createForm(root)!, { type: 'success', status: 200, data: { action: 'createTickerTemplate', ok: true } });
    await tick(3);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('from now on');
  });

  it('an edited template that is gone after the reload drops back to the add form', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    expect(createForm(root)).toBeNull();
    props.templates = ok(true, [nightly]);
    await tick(3);
    expect(createForm(root)).not.toBeNull();
  });
});

describe('route change and late results', () => {
  it('another Agent reseeds: nothing typed for the first survives', async () => {
    const { props, root } = await mountReactive();
    type(field(createForm(root)! as never, 'name'), 'half-typed');
    await tick(2);
    props.agentId = 'agent-2';
    props.templates = ok(true, []);
    await tick(3);
    expect(field(createForm(root)! as never, 'name').value).toBe('');
  });

  it('a result that lands after the Agent changed touches nothing: no status, no reload', async () => {
    const { props, root } = await mountReactive();
    type(field(createForm(root)! as never, 'name'), 'a');
    await tick(2);
    const deliver = await beginEnhanced(createForm(root)!);
    await tick(2);
    props.agentId = 'agent-2';
    props.templates = ok(true, []);
    await tick(3);
    await deliver({ type: 'success', status: 200, data: { action: 'createTickerTemplate', ok: true } });
    await tick(3);
    expect(root.querySelector('p[role="status"]')).toBeNull();
    expect(invalidations()).toBe(0);
  });
});

describe('delete', () => {
  const del = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action="?/deleteTickerTemplate"]');
  const buttonNamed = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

  it('is two steps: Delete alone sends nothing and opens a confirm that names the template', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    expect(del(root)).toBeNull();
    buttonNamed(root, 'Delete').click();
    await tick(3);
    expect(del(root)).not.toBeNull();
    expect(del(root)!.textContent).toContain('nightly');
    buttonNamed(root, 'Cancel').click();
    await tick(3);
    expect(del(root)).toBeNull();
  });

  it('the confirm carries the id and the revision the page read', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    buttonNamed(root, 'Delete').click();
    await tick(3);
    expect(del(root)!.querySelector<HTMLInputElement>('input[name="id"]')!.value).toBe('tpl-2');
    expect(del(root)!.querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('9');
  });

  it('a stale-revision refusal is shown and nothing is retried or reloaded', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    buttonNamed(root, 'Delete').click();
    await tick(3);
    await submitEnhancedWithResult(del(root)!, {
      type: 'failure', status: 409, data: { action: 'deleteTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH', message: 'stale' } },
    });
    await tick(3);
    expect(root.querySelector('[data-testid="agent-template-delete-tpl-2"] [role="alert"]')?.textContent).toContain('TICKER_TEMPLATE_REVISION_MISMATCH');
    expect(invalidations()).toBe(0);
  });

  it('a result that lands after the Agent changed touches nothing: no reload', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'nightly');
    buttonNamed(root, 'Delete').click();
    await tick(3);
    const deliver = await beginEnhanced(del(root)!);
    await tick(2);
    props.agentId = 'agent-2';
    props.templates = ok(true, []);
    await tick(3);
    await deliver({ type: 'success', status: 200, data: { action: 'deleteTickerTemplate', ok: true } });
    await tick(3);
    expect(invalidations()).toBe(0);
  });

  it('a success re-reads', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    buttonNamed(root, 'Delete').click();
    await tick(3);
    await submitEnhancedWithResult(del(root)!, { type: 'success', status: 200, data: { action: 'deleteTickerTemplate', ok: true } });
    await tick(3);
    expect(invalidations()).toBeGreaterThan(0);
  });
});

describe('keyboard focus (UX P2s, portal#1613)', () => {
  const byLabel = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

  it('Edit moves focus to the form heading, and again when switching templates', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    const heading = root.querySelector<HTMLElement>('#agent-template-form-heading')!;
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
    (document.activeElement as HTMLElement).blur();
    await openEdit(root, 'standup');
    expect(document.activeElement).toBe(root.querySelector('#agent-template-form-heading'));
  });

  it('Delete focuses Confirm delete; Cancel returns focus to Delete', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    byLabel(root, 'Delete').click();
    await tick(3);
    expect(document.activeElement).toBe(byLabel(root, 'Confirm delete'));
    byLabel(root, 'Cancel').click();
    await tick(3);
    expect(document.activeElement).toBe(byLabel(root, 'Delete'));
  });

  it('Cancel clears a refusal left by a stale delete', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    byLabel(root, 'Delete').click();
    await tick(3);
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('form[action="?/deleteTickerTemplate"]')!, {
      type: 'failure', status: 409, data: { action: 'deleteTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH', message: 'stale' } },
    });
    await tick(3);
    byLabel(root, 'Cancel').click();
    await tick(3);
    expect(root.querySelector('[data-testid="agent-template-delete-tpl-2"] [role="alert"]')).toBeNull();
  });
});

describe('LOCAL review P2s (portal#1613)', () => {
  const rev5 = { ...standup, name: 'someone else', revision: 5 };
  const okResult = (action: string) => ({ type: 'success' as const, status: 200, data: { action, ok: true } });
  const submitBtn = (root: HTMLElement) => updateForm(root).querySelector<HTMLButtonElement>('button[type="submit"]')!;

  it('a dirty draft keeps the revision and baseline it was started from when an unrelated reload brings a newer one', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'my draft');
    await tick(2);
    props.templates = ok(true, [rev5, nightly]);
    await tick(3);
    flushSync();
    const f = updateForm(root);
    expect(f.querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('4');
    expect(field(f as never, 'nameWas').value).toBe('standup');
    expect(field(f as never, 'name').value).toBe('my draft');
  });

  it('with nothing typed, a newer read is adopted (clean refresh positive)', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    props.templates = ok(true, [rev5, nightly]);
    await tick(3);
    flushSync();
    expect(updateForm(root).querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('5');
    expect(field(updateForm(root) as never, 'name').value).toBe('someone else');
  });

  it('an explicit Reload latest advances the baseline to the newer read', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'my draft');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), {
      type: 'failure', status: 409, data: { action: 'updateTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH', message: 'x' } },
    });
    await tick(3);
    navigationHooks.onInvalidateAll = () => {
      props.templates = ok(true, [rev5, nightly]);
    };
    [...updateForm(root).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reload latest')!.click();
    await tick(10);
    flushSync();
    expect(updateForm(root).querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('5');
  });

  it('the request stays pending through the refresh and a duplicate submit is cancelled', async () => {
    const root = await mountPanel();
    let release!: () => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((r) => (release = r));
    const deliver = await beginEnhanced(createForm(root)!);
    const done = deliver(okResult('createTickerTemplate'));
    await tick(3);
    expect(createForm(root)!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect((await submitEnhanced(createForm(root)!)).cancelled).toBe(true);
    release();
    await done;
    await tick(3);
    expect(createForm(root)!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('a late success does not steal focus the reader moved to another field', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    const deliver = await beginEnhanced(updateForm(root));
    const cadence = field(updateForm(root) as never, 'cadenceSeconds');
    cadence.focus();
    await deliver(okResult('updateTickerTemplate'));
    await tick(3);
    expect(document.activeElement).toBe(cadence);
  });

  it('a confirmed write whose refresh rejects says so, sends nothing again, and does not throw', async () => {
    const root = await mountPanel();
    navigationHooks.onInvalidateAll = () => Promise.reject(new Error('refresh 500'));
    await submitEnhancedWithResult(createForm(root)!, okResult('createTickerTemplate'));
    await tick(3);
    expect(root.querySelector('[data-testid="agent-template-create-refresh-failed"]')?.textContent).toMatch(/accepted/);
    expect(createForm(root)!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it('a confirmed delete whose refresh rejects says so and offers no second delete', async () => {
    const root = await mountPanel();
    await openEdit(root, 'nightly');
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete')!.click();
    await tick(3);
    navigationHooks.onInvalidateAll = () => Promise.reject(new Error('refresh 500'));
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('form[action="?/deleteTickerTemplate"]')!, okResult('deleteTickerTemplate'));
    await tick(3);
    expect(root.querySelector('[data-testid="agent-template-delete-refresh-failed"]')).not.toBeNull();
    const confirmBtn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Confirm delete')!;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('a typed not-found refusal offers an explicit reload', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), {
      type: 'failure', status: 404, data: { action: 'updateTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_NOT_FOUND', message: 'no longer exists' } },
    });
    await tick(3);
    expect([...updateForm(root).querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Reload latest')).toBe(true);
  });

  const staleRefusal = { type: 'failure' as const, status: 409, data: { action: 'updateTickerTemplate', refusal: { kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH', message: 'x' } } };
  const reloadBtn = (root: HTMLElement) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reload latest')!;

  it('a Reload that rejects after a refused write says it could not load, never that a change was accepted', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), staleRefusal);
    await tick(3);
    navigationHooks.onInvalidateAll = () => Promise.reject(new Error('reload 500'));
    reloadBtn(root).click();
    await tick(5);
    expect(updateForm(root).textContent).not.toMatch(/accepted/);
    expect(updateForm(root).querySelector('[data-testid$="-reload-failed"]')).not.toBeNull();
  });

  it('a Reload still pending when the reader opens another template touches nothing of the new one', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), staleRefusal);
    await tick(3);
    let fail!: () => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((_, rej) => (fail = () => rej(new Error('reload 500'))));
    reloadBtn(root).click();
    await tick(2);
    navigationHooks.onInvalidateAll = undefined;
    await openEdit(root, 'nightly');
    fail();
    await tick(6);
    const f = updateForm(root);
    expect(field(f as never, 'name').value).toBe('nightly');
    expect(f.querySelector('[role="alert"]')).toBeNull();
    expect(f.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    expect(f.querySelector('[data-testid$="-refresh-failed"], [data-testid$="-reload-failed"]')).toBeNull();
  });

  it('while a Reload is re-reading, Save is disabled and a submit is cancelled; the reload then completes and re-enables Reload latest', async () => {
    const root = await mountPanel();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), staleRefusal);
    await tick(3);
    let release!: () => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((r) => (release = r));
    reloadBtn(root).click();
    await tick(3);
    expect(updateForm(root).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect((await submitEnhanced(updateForm(root))).cancelled).toBe(true);
    release();
    await tick(15);
    expect(reloadBtn(root)?.disabled ?? false).toBe(false);
    expect(updateForm(root).querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('a Reload that SUCCEEDS after the reader opened another template does not re-base the new template draft', async () => {
    const { props, root } = await mountReactive();
    await openEdit(root, 'standup');
    type(field(updateForm(root) as never, 'name'), 'daily');
    await tick(2);
    await submitEnhancedWithResult(updateForm(root), staleRefusal);
    await tick(3);
    let release!: () => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((r) => (release = r));
    reloadBtn(root).click();
    await tick(2);
    navigationHooks.onInvalidateAll = undefined;
    await openEdit(root, 'nightly');
    type(field(updateForm(root) as never, 'name'), 'night draft');
    await tick(2);
    props.templates = ok(true, [standup, { ...nightly, name: 'theirs', revision: 10 }]);
    release();
    await tick(15);
    flushSync();
    expect(updateForm(root).querySelector<HTMLInputElement>('input[name="expectedRevision"]')!.value).toBe('9');
    expect(field(updateForm(root) as never, 'name').value).toBe('night draft');
  });
});
