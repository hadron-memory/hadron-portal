/**
 * portal#1090, Diego's P2-1 on #1135: a browser-to-portal failure on create
 * (a lost response, a fetch error: an ActionResult of type "error") shows the
 * fixed uncertainty line and keeps the form, instead of falling through to
 * the error page. The task may already exist, so it never says "failed".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

describe('create page: a transport error', () => {
  it('shows the uncertainty line and keeps what was typed', async () => {
    const m = mountComponent(Page as never, {
      data: { app, candidates: { workers: [], people: [] }, roles: [], families: [], canWrite: true, impersonating: null },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const title = m.target.querySelector<HTMLInputElement>('#new-title')!;
    title.value = 'Keep me';
    const form = m.target.querySelector<HTMLFormElement>('form')!;
    await submitEnhancedWithResult(form, { type: 'error', status: 500, data: {} } as never);
    await tick(2);
    expect(m.target.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(m.target.querySelector<HTMLInputElement>('#new-title')?.value).toBe('Keep me');
    expect(m.target.querySelector('form')).not.toBeNull();
  });
});

// Clark's browser P2 on #1135: switching where the task starts must keep
// what was typed. Only the assignee and requirements hide.
//
// The cause shows only after HYDRATION, as in the browser. Every text field's
// `value` sits in one template effect that also reads the start radios.
// Hydration's remove_input_defaults strips the SSR `value` attribute through
// set_attribute(input, 'value', null), which leaves Svelte's cached value at
// null; the radio's re-run then sees null !== '' and writes '' over the typed
// text. A plain mount caches '' and skips that write. This test applies the
// same set_attribute step hydration does, then switches the radio.
// @ts-expect-error -- svelte/internal/client ships no types; it's used here only to apply hydration's exact step.
import { set_attribute } from 'svelte/internal/client';

describe('create page: switching to the backlog keeps the typed fields', () => {
  it('keeps title, source and tags across a start-mode change, after hydration strips the value defaults', async () => {
    const m = mountComponent(Page as never, {
      data: { app, candidates: { workers: [{ id: 'w1', name: 'Dara', role: 'eng', urn: null }], people: [] }, roles: [], families: [], canWrite: true, impersonating: null },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    for (const sel of ['#new-title', '#new-source', '#new-tags']) set_attribute(m.target.querySelector(sel)!, 'value', null);
    const type = (sel: string, value: string) => {
      const el = m.target.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('#new-title', 'Inspect backlog');
    type('#new-description', 'Look closely');
    type('#new-source', 'https://x.test/1');
    type('#new-tags', 'a, b');
    m.target.querySelector<HTMLInputElement>('input[name="start"][value="backlog"]')!.click();
    await tick(3);
    expect(m.target.querySelector<HTMLInputElement>('#new-title')?.value).toBe('Inspect backlog');
    expect(m.target.querySelector<HTMLTextAreaElement>('#new-description')?.value).toBe('Look closely');
    expect(m.target.querySelector<HTMLInputElement>('#new-source')?.value).toBe('https://x.test/1');
    expect(m.target.querySelector<HTMLInputElement>('#new-tags')?.value).toBe('a, b');
    expect(m.target.querySelector('#new-assignee')).toBeNull();
    m.target.querySelector<HTMLInputElement>('input[name="start"][value="now"]')!.click();
    await tick(3);
    expect(m.target.querySelector<HTMLInputElement>('#new-title')?.value).toBe('Inspect backlog');
  });
});

// Clark's trigger B (same P2): after a browser-to-portal error the fixed line
// shows, and the typed fields must survive the re-render it causes.
describe('create page: a transport error keeps the typed fields', () => {
  it('keeps title, source and tags after an error result, after hydration strips the value defaults', async () => {
    const m = mountComponent(Page as never, {
      data: { app, candidates: { workers: [], people: [] }, roles: [], families: [], canWrite: true, impersonating: null },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    for (const sel of ['#new-title', '#new-source', '#new-tags']) set_attribute(m.target.querySelector(sel)!, 'value', null);
    for (const [sel, value] of [['#new-title', 'Transport retained'], ['#new-source', 'note'], ['#new-tags', 'x']] as const) {
      const el = m.target.querySelector<HTMLInputElement>(sel)!;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>('form')!, { type: 'error', status: 500, data: {} } as never);
    await tick(3);
    expect(m.target.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(m.target.querySelector<HTMLInputElement>('#new-title')?.value).toBe('Transport retained');
    expect(m.target.querySelector<HTMLInputElement>('#new-source')?.value).toBe('note');
    expect(m.target.querySelector<HTMLInputElement>('#new-tags')?.value).toBe('x');
  });
});

// portal#1214: a create whose response carried warnings is answered in place.
// The page is MOUNTED with the form showing, then given the action's result the
// way kit's applyAction does, so the test sees the form go and the panel come.
import { reactiveProps } from '$lib/test/reactiveProps.svelte';

describe('create page: a warned create replaces the form', () => {
  const data = { app, candidates: { workers: [], people: [] }, roles: [], families: [], canWrite: true, impersonating: null };
  async function warned(result: Record<string, unknown>) {
    const props = reactiveProps<Record<string, unknown>>({ data, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.querySelector('form')).not.toBeNull();
    const form = m.target.querySelector<HTMLFormElement>('form')!;
    // The submit callback runs (as kit would) before the result lands.
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: result } as never);
    props.form = result;
    await tick(3);
    return m.target;
  }

  it('removes the form, says created, lists the warnings and links to the new task', async () => {
    const root = await warned({
      created: { id: 't9' }, committedWithError: false, more: 0,
      warnings: [{ code: 'task.create.no-source', text: 'This task has no source.' }],
    });
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('button[type="submit"]')).toBeNull();
    const panel = root.querySelector('[data-testid="task-created"]')!;
    expect(panel.querySelector('h2')?.textContent?.trim()).toBe('Task created. 1 warning below.');
    expect(panel.querySelector('h2')?.getAttribute('role')).toBeNull();
    expect(panel.querySelector('[data-testid="task-warnings"]')?.textContent).toContain('This task has no source.');
    expect(panel.querySelector('a')?.getAttribute('href')).toBe('/app/apps/app-1/tasks/t9');
  });

  it('without an id, a committed-with-error create says so and links to the Tasks list', async () => {
    const root = await warned({ created: { id: null }, committedWithError: true, more: 0, warnings: [{ code: 'c', text: 't' }] });
    expect(root.querySelector('form')).toBeNull();
    const panel = root.querySelector('[data-testid="task-created"]')!;
    expect(panel.querySelector('h2')?.textContent?.trim()).toBe('Task created, but the server’s response also reported an error. 1 warning below.');
    expect(panel.textContent).not.toContain('Not changed');
    expect(panel.querySelector('a')?.getAttribute('href')).toBe('/app/apps/app-1/tasks');
  });

  it('a refusal still keeps the form (the panel is only for a created task)', async () => {
    const props = reactiveProps<Record<string, unknown>>({ data, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    props.form = { refusal: { kind: 'uncertain' }, values: { title: 'Keep me' } };
    await tick(3);
    expect(m.target.querySelector('form')).not.toBeNull();
    expect(m.target.querySelector('[data-testid="task-created"]')).toBeNull();
  });
});

// portal#1530 — the create page's min-tier help must carry the same qualified
// sentence as the Edit panel (one key, one default), and the minTier control
// must serialize unchanged: '' for "Any", the tier once selected.
import { MIN_TIER_HELP } from '$lib/test/minTierHelp';

describe('create page: min-tier help (portal#1530)', () => {
  async function mountCreatePage() {
    const m = mountComponent(Page as never, {
      data: { app, candidates: { workers: [], people: [] }, roles: [], families: [], canWrite: true, impersonating: null },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return m.target as HTMLElement;
  }

  it('with "Any" selected, qualifies the exclusion to a selected minimum and serializes no minimum', async () => {
    const root = await mountCreatePage();
    expect(root.querySelector('#new-min-tier-help')!.textContent).toBe(MIN_TIER_HELP);
    const select = root.querySelector<HTMLSelectElement>('#new-min-tier')!;
    expect(select.value).toBe('');
    const form = root.querySelector<HTMLFormElement>('form')!;
    expect(new FormData(form).get('minTier')).toBe('');
  });

  it('with a minimum picked, shows the same sentence and serializes the tier', async () => {
    const root = await mountCreatePage();
    expect(root.querySelector('#new-min-tier-help')!.textContent).toBe(MIN_TIER_HELP);
    const select = root.querySelector<HTMLSelectElement>('#new-min-tier')!;
    select.value = 'mid';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    const form = root.querySelector<HTMLFormElement>('form')!;
    expect(new FormData(form).get('minTier')).toBe('mid');
  });
});

// portal#2161 review: the clone form's bound family lists must re-seed from the INCOMING clone's
// requirements on a same-route App change — the loader's cross-App redirect lands on this same
// route component, so the re-seed effect runs without a remount, and [] would read as "emptied"
// against the new requirementsBase and silently drop the copy on save.
describe('clone form: a same-route App change re-seeds the family pre-fill (portal#2161)', () => {
  const cloneOf = (appId: string, familyIn: string[]) => ({
    source: { id: `${appId}-src`, handle: 'AT1.x', title: 'Source' },
    parent: { choice: 'none', task: null },
    values: {
      title: 'T', description: '', source: '', tags: '', closeSessionWhenDone: false, priority: null, references: '[]',
      requirements: JSON.stringify({ role: null, familyIn, familyNotIn: [], excludeWorkers: [], minTier: null }),
    },
  });
  const dataWith = (appId: string, clone: ReturnType<typeof cloneOf>) => ({
    app: appId === 'app-1' ? app : { ...app, id: appId },
    clone,
    candidates: { workers: [], people: [] }, roles: [], families: [], canWrite: true, impersonating: null,
  });

  it('keeps the incoming clone’s families selected, so the copy survives the save', async () => {
    const props = reactiveProps<Record<string, unknown>>({ data: dataWith('app-1', cloneOf('app-1', ['claude'])), form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const selected = () => [...m.target.querySelectorAll<HTMLSelectElement>('#new-family-in option')].filter((o) => o.selected).map((o) => o.value);
    expect(selected()).toEqual(['claude']);
    // The cross-App redirect resolves to the SAME route: data updates without a remount.
    props.data = dataWith('app-2', cloneOf('app-2', ['glm']));
    await tick(3);
    expect(selected()).toEqual(['glm']);
    // What the save would post: the families beside the NEW base, not emptied against it.
    const fd = new FormData(m.target.querySelector<HTMLFormElement>('form')!);
    expect(fd.getAll('familyIn')).toEqual(['glm']);
    expect(String(fd.get('requirementsBase'))).toContain('glm');
  });
});
