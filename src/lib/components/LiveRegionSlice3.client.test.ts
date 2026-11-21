/**
 * portal#2376 slice 3 (group C): the availability and failure notes in shared components speak
 * from a status region that was mounted, empty, BEFORE the note appeared (portal#2344).
 *
 * Each pin is before / during / after: the region that speaks existed and was empty first, holds the
 * note while the condition holds, and is the SAME element, empty again, once it clears. A conditionally
 * mounted `role="status"` fails the first assertion because the element is created with the text in it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { signaturesView } from '$lib/node-signatures';
import NodeSignatures from './NodeSignatures.svelte';
import PropertyFilter from './PropertyFilter.svelte';
import DefinitionRegisterSection from './action-register/DefinitionRegisterSection.svelte';
import PartyPicker from './agent-tasks/PartyPicker.svelte';
import TaskPlanning from './agent-tasks/TaskPlanning.svelte';
import StopBanner from './stops/StopBanner.svelte';
import StopSignalsPanel from './stops/StopSignalsPanel.svelte';
import TickerAddSubscriber from './tickers/TickerAddSubscriber.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetStubPage();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function mount(component: unknown, props: Record<string, unknown>) {
  const p = reactiveProps<Record<string, unknown>>(props);
  const m = mountComponent(component as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return { root: m.target, props: p };
}

/** The status region currently holding `text`, or null. */
function speaking(root: HTMLElement, text: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes(text)) ?? null;
}

/**
 * Run a before / during / after pin. `idle` is every empty status region before the note; the region
 * that later holds `text` must be one of them, and must be that same element, empty, afterwards.
 */
async function pin(root: HTMLElement, text: string, show: () => unknown, hide: () => unknown) {
  expect(speaking(root, text), 'not shown before').toBeNull();
  const idle = idleStatusRegions(root);
  expect(idle.length, 'a status region exists, empty, before the condition').toBeGreaterThan(0);
  await show();
  await tick(3);
  const region = speaking(root, text);
  expect(region, 'the note is inside a status region').not.toBeNull();
  expect(idle, 'that region existed, empty, before the note').toContain(region);
  expect(region!.getAttribute('aria-live')).toBe('polite');
  await hide();
  await tick(3);
  expect(region!.isConnected, 'the region outlives the note').toBe(true);
  expect(region!.textContent!.trim()).toBe('');
  expect(idleStatusRegions(root)).toContain(region);
}

/** A condition fixed at load: the note is inside a polite status region. */
function atLoad(root: HTMLElement, text: string) {
  const region = speaking(root, text);
  expect(region, 'the note is inside a status region').not.toBeNull();
  expect(region!.getAttribute('aria-live')).toBe('polite');
  return region!;
}

describe('NodeSignatures: integrity problems', () => {
  const view = (integrityProblems: number) => signaturesView({ ok: true, value: {
    state: 'CURRENT', integrityProblems,
    signatures: [{ id: 's1', signer: { handle: 'holger', urn: 'hrn:user:holger' }, passkeyLabel: 'Key', passkeyRevokedAt: null, revision: 5, verifiedAt: '2026-10-14T10:00:00Z', state: 'CURRENT' }],
  } } as never);
  it('the note appears in, and clears from, the same status region', async () => {
    const { root, props } = await mount(NodeSignatures, { view: view(0) });
    await pin(root, 'failed verification', () => { props.view = view(2); }, () => { props.view = view(0); });
  });
});

describe('PropertyFilter: field-required hint', () => {
  const setup = async () => {
    const m = await mount(PropertyFilter, { collection: { fields: { title: { type: 'text' }, n: { type: 'number' } } }, value: '' });
    const field = m.root.querySelector<HTMLSelectElement>('#property-filter-field')!;
    const pick = (name: string) => { field.value = name; field.dispatchEvent(new Event('change', { bubbles: true })); flushSync(); };
    const type = (text: string) => { const i = m.root.querySelector<HTMLInputElement>('#property-filter-value')!; i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };
    return { ...m, pick, type };
  };
  it('"Choose a field" appears in, and clears from, the same status region', async () => {
    const { root, pick, type } = await setup();
    pick('title'); type('x'); await tick(2); // a valid filter: no hint
    await pin(root, 'Choose a field before applying a filter.', () => pick(''), () => { pick('title'); type('x'); });
  });
  it('"Choose or enter a valid value" appears in, and clears from, the same status region', async () => {
    const { root, pick, type } = await setup();
    pick('n'); type('1'); await tick(2);
    await pin(root, 'Choose or enter a valid value before applying.', () => type('abc'), () => type('1'));
  });
  it('present at load (empty draft) the hint is already inside a polite status region (fixed at load, no before state)', async () => {
    const { root } = await setup();
    atLoad(root, 'Choose a field before applying a filter.');
  });
});

describe('DefinitionRegisterSection', () => {
  const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team' };
  const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
  const ready = (index: unknown) => ({ kind: 'ready', apps: [app], app, appId: app.id, limit: 20, offset: 0, definitionUrn: 'hrn:node:acme.com:base:tasks:build', key: 'app-1|20|0', index });
  const unavailable = { kind: 'unavailable' };
  const base = { agent, basePath: '/app/agents/g1/definitions/tasks%3Abuild' };

  it('"isn’t available for this Agent" appears in, and clears from, the same status region', async () => {
    setStubPage('http://localhost/app/agents/g1/definitions/tasks%3Abuild?app=app-1');
    const { root, props } = await mount(DefinitionRegisterSection, { ...base, register: ready({ kind: 'ok', page: { entries: [], total: 0, hasMore: false } }) });
    await pin(root, 'isn’t available for this Agent', () => { props.register = unavailable; }, () => { props.register = ready({ kind: 'ok', page: { entries: [], total: 0, hasMore: false } }); });
  });
  it('"Not available for this App." appears in, and clears from, the same status region', async () => {
    setStubPage('http://localhost/app/agents/g1/definitions/tasks%3Abuild?app=app-1');
    const { root, props } = await mount(DefinitionRegisterSection, { ...base, register: ready({ kind: 'ok', page: { entries: [], total: 0, hasMore: false } }) });
    await pin(root, 'Not available for this App.', () => { props.register = ready({ kind: 'app-not-found' }); }, () => { props.register = ready({ kind: 'ok', page: { entries: [], total: 0, hasMore: false } }); });
  });
});

describe('PartyPicker: members not listed', () => {
  const props = { name: 'assignee', id: 'a', label: 'Assignee', value: '', other: '', workers: [{ id: 'w1', name: 'Ada', role: null, urn: null }], people: [] };
  it('the failed-read note appears in, and clears from, the same status region', async () => {
    const { root, props: p } = await mount(PartyPicker, props);
    await pin(root, 'Couldn’t load this App’s members', () => { p.peopleFailed = true; }, () => { p.peopleFailed = false; });
  });
  it('the withheld note appears in, and clears from, the same status region', async () => {
    const { root, props: p } = await mount(PartyPicker, props);
    await pin(root, 'members aren’t visible to you', () => { p.peopleWithheld = true; }, () => { p.peopleWithheld = false; });
  });
  it('one region carries both notes: failed turning into withheld swaps text, not region', async () => {
    const { root, props: p } = await mount(PartyPicker, props);
    p.peopleFailed = true; await tick(2);
    const region = speaking(root, 'Couldn’t load this App’s members')!;
    p.peopleFailed = false; p.peopleWithheld = true; await tick(2);
    expect(speaking(root, 'members aren’t visible to you')).toBe(region);
  });
});

describe('TaskPlanning', () => {
  const task = { id: 't1', appId: 'app', status: 'PENDING', priority: 3 };
  const ok = { kind: 'ok', value: { blockedBy: { items: [], hasMore: false }, blocks: { items: [], hasMore: false } } };
  it('"Blocker relations are unavailable" appears in, and clears from, the same status region', async () => {
    const { root, props } = await mount(TaskPlanning, { task, appId: 'app', canWrite: true, dependencies: ok });
    await pin(root, 'Blocker relations are unavailable', () => { props.dependencies = { kind: 'failed' }; }, () => { props.dependencies = ok; });
  });
  it('"Couldn’t refresh facts" speaks from the save-result region, and a later save replaces it in place', async () => {
    const { root } = await mount(TaskPlanning, { task, appId: 'app', canWrite: true, dependencies: ok });
    const idle = idleStatusRegions(root);
    expect(speaking(root, 'Couldn’t refresh facts')).toBeNull();
    navigationHooks.onInvalidateAll = () => { throw new Error('offline'); };
    const form = root.querySelector<HTMLFormElement>('form[action="?/priority"]')!;
    await submitEnhancedWithResult(form, { type: 'failure', status: 409, data: { refusal: { kind: 'refused', code: 'TASK_ENDED', message: 'Ended.' } } });
    await tick(4);
    const region = speaking(root, 'Couldn’t refresh facts')!;
    expect(region, 'the note is inside a status region').not.toBeNull();
    expect(idle, 'that region existed, empty, before the note').toContain(region);
    navigationHooks.onInvalidateAll = undefined;
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: {} });
    await tick(4);
    expect(speaking(root, 'Saved. Facts refreshed.')).toBe(region);
    expect(region.textContent).not.toContain('Couldn’t refresh facts');
  });
});

describe('StopBanner', () => {
  const sig = { id: '1', level: 'PAUSE', scope: 'WORKER', targetWorkerId: 'w1', until: null, live: true };
  const open = { kind: 'ok', value: { complete: true, signals: [sig] } };
  const none = { kind: 'ok', value: { complete: true, signals: [] } };
  const workers = [{ id: 'w1', name: 'Gaby', urn: null }];
  it('"Couldn’t check whether any stops are in effect" appears in, and clears from, the same status region', async () => {
    const { root, props } = await mount(StopBanner, { live: none, workers, href: '/stops' });
    await pin(root, 'Couldn’t check whether any stops', () => { props.live = { kind: 'failed' }; }, () => { props.live = none; });
  });
  it('the open-stops banner appears in, and clears from, the same status region', async () => {
    const { root, props } = await mount(StopBanner, { live: none, workers, href: '/stops' });
    await pin(root, '1 stop is in effect', () => { props.live = open; }, () => { props.live = none; });
  });
  it('present at load, the banner is still inside a polite status region (fixed at load, no before state)', async () => {
    const { root } = await mount(StopBanner, { live: open, workers, href: '/stops' });
    expect(atLoad(root, '1 stop is in effect').querySelector('[data-testid="stop-banner"]')).not.toBeNull();
  });
});

describe('StopSignalsPanel: could not check whether you manage the App', () => {
  it('the hint appears in, and clears from, the same status region', async () => {
    const { root, props } = await mount(StopSignalsPanel, { appId: 'app-1', manages: 'yes', workers: [{ id: 'w1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }], impersonating: null, lifting: null, onliftclose: () => {} });
    await pin(root, 'Couldn’t check whether you manage this App', () => { props.manages = 'unknown'; }, () => { props.manages = 'yes'; });
  });
});

describe('TickerAddSubscriber', () => {
  const props = { appId: 'app-1', ticker: { id: 'tk-1', name: 'standup' }, roster: { kind: 'ok', workers: [{ id: 'w-1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }] }, viewerId: 'u-1', impersonating: null, onRosterRetry: () => {} };
  it('the roster-failed note appears in, and clears from, the same status region', async () => {
    const { root, props: p } = await mount(TickerAddSubscriber, props);
    await pin(root, 'Try again', () => { p.roster = { kind: 'failed' }; }, () => { p.roster = props.roster; });
  });
  it('the announcement-failed note appears in the status region that existed before the add', async () => {
    const { root } = await mount(TickerAddSubscriber, props);
    [...root.querySelectorAll('button')].find((b) => /Add subscriber/.test(b.textContent ?? ''))!.click();
    await tick(2);
    const form = root.querySelector<HTMLFormElement>('form')!;
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.value = 'w-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(2);
    [...form.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? ''))!.click();
    await tick(2);
    const idle = idleStatusRegions(root);
    expect(idle.length, 'the result and announcement regions both exist, empty, before the add').toBeGreaterThanOrEqual(2);
    expect(root.querySelector('[data-testid="ticker-add-announcement"]')).toBeNull();
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'subscribe', ok: true, target: 'w-1', announcementFailed: true } });
    await tick(4);
    const note = root.querySelector('[data-testid="ticker-add-announcement"]')!;
    const region = note.closest<HTMLElement>('[role="status"]')!;
    expect(idle).toContain(region);
    expect(region.getAttribute('aria-live')).toBe('polite');
  });
});
