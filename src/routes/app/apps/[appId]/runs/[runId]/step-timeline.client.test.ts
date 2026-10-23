/**
 * portal#482 — the run detail page's step timeline, on the REAL page with data
 * from the REAL loader (the #995 harness pattern). The trail is the COMPLETED
 * hops of AppRun.hops: the current/failed step is never a row, an unreadable
 * trail is "unavailable" (never zero hops), and a trail belongs to the run it
 * was read for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { AGENT_TASKS_APP_QUERY, APP_QUERY, APP_RUN_ENVELOPE_QUERY, APP_RUN_HOPS_QUERY, APP_RUN_QUERY } from '$lib/server/queries';
import Page from './+page.svelte';
import { load } from './+page.server';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const APP = { id: 'app-1', name: 'Digest', organizationId: 'org-1' };
const CLASSIFY = 'hrn:node:acme.com:flows:classify';
const REPLY = 'hrn:node:acme.com:flows:reply';
const CURRENT = 'hrn:node:acme.com:flows:summarise';

let runOver: Record<string, unknown> = {};
let hopsAnswer: unknown = null;
let hopsError = false;

const baseRun = () => ({
  id: 'run-1', organizationId: 'org-1', appId: 'app-1', status: 'COMPLETED',
  entryNodeUrn: CLASSIFY, triggerKind: 'MANUAL', eventData: null, failure: null,
  curNodeUrn: null, attempts: 1, startedAt: '2026-10-01T10:00:00.000Z',
  finishedAt: '2026-10-01T10:00:09.000Z', createdAt: '2026-10-01T09:59:00.000Z',
  ...runOver,
});
const hop = (over: Record<string, unknown> = {}) => ({
  node: CLASSIFY, edgeOut: 'to-reply',
  startedAt: 1790848800000, finishedAt: 1790848802000,
  tokensSpent: 1200, ...over,
});

beforeEach(() => {
  runOver = {}; hopsAnswer = null; hopsError = false;
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setStubPage('http://localhost/app/apps/app-1/runs/run-1', { appId: 'app-1', runId: 'run-1' });
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === APP_QUERY || doc === AGENT_TASKS_APP_QUERY) return { app: APP };
    if (doc === APP_RUN_QUERY) return { appRun: baseRun() };
    if (doc === APP_RUN_ENVELOPE_QUERY) return { appRun: { id: 'run-1', data: null } };
    if (doc === APP_RUN_HOPS_QUERY) {
      if (hopsError) throw new Error('Cannot query field "hops" on type "AppRun".');
      return { appRun: { id: 'run-1', hops: hopsAnswer } };
    }
    throw new Error(`unexpected query: ${doc.slice(0, 60)}`);
  });
});
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function settle() {
  for (let i = 0; i < 10; i++) await tick();
  flushSync();
}
async function mountPage() {
  const loaded = (await load({
    params: { appId: 'app-1', runId: 'run-1' },
    locals: { token: 'tok' },
  } as never)) as Record<string, unknown>;
  const props = reactiveProps<Record<string, unknown>>({ data: loaded, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return m;
}
const rows = (m: Mounted<Record<string, unknown>>) => m.target.querySelectorAll('[data-testid="hop-row"]');
const text = (m: Mounted<Record<string, unknown>>) => m.target.textContent ?? '';

describe('run step timeline (portal#482)', () => {
  it('renders one row per completed hop, in order, with duration, tokens and the edge taken FROM it', async () => {
    hopsAnswer = [hop(), hop({ node: REPLY, edgeOut: null, tokensSpent: 0, finishedAt: 1790848805000, startedAt: 1790848803000 })];
    const m = await mountPage();
    const r = rows(m);
    expect(r).toHaveLength(2);
    expect(r[0].textContent).toContain('classify');
    expect(r[0].textContent).toContain('1,200');
    expect(r[0].textContent).toContain('2s');
    expect(r[0].textContent).toContain('to-reply');
    expect(r[1].textContent).toContain('reply');
    expect(r[1].textContent).not.toContain('to-reply');
    expect(r[1].textContent).toMatch(/\b0\b/);
  });

  it('the edge is a routing NAME: shown as plain escaped text, never as an invented URN with copy controls', async () => {
    hopsAnswer = [hop({ edgeOut: '<b>next</b>' })];
    const m = await mountPage();
    const edge = rows(m)[0].querySelector('[data-testid="hop-edge"]');
    expect(edge?.textContent).toBe('<b>next</b>');
    expect(edge?.querySelector('b')).toBeNull();
    expect(rows(m)[0].textContent).not.toContain('hrn:edge');
    expect(rows(m)[0].querySelectorAll('button')).toHaveLength(2); // the step's own copy URN / URL only
  });

  it('a long unbroken routing name wraps inside its cell instead of widening the page (UX P2)', async () => {
    hopsAnswer = [hop({ edgeOut: 'x'.repeat(60) })];
    const m = await mountPage();
    const edge = rows(m)[0].querySelector('[data-testid="hop-edge"]') as HTMLElement;
    // jsdom has no layout, so pin the three things that bound it: the cell may
    // shrink (min-w-0), the text may break anywhere, and the row clips nothing.
    expect(edge.className).toContain('[overflow-wrap:anywhere]');
    expect(edge.parentElement?.className).toContain('min-w-0');
    expect(edge.parentElement?.parentElement?.className).toContain('min-w-0');
  });

  it('null tokens read as unknown, not 0', async () => {
    hopsAnswer = [hop({ tokensSpent: null, edgeOut: null })];
    const m = await mountPage();
    expect(rows(m)[0].textContent).toContain('—');
    expect(rows(m)[0].textContent).not.toMatch(/\b0\b/);
  });

  it('an empty trail says nothing was recorded, not that it is unavailable', async () => {
    hopsAnswer = [];
    const m = await mountPage();
    expect(rows(m)).toHaveLength(0);
    expect(text(m)).toContain('No completed steps recorded');
    expect(text(m)).not.toContain('Step trail unavailable');
  });

  it.each([
    ['absent', null],
    ['malformed', [{ node: 3 }]],
    ['not an array', { nope: true }],
  ])('a %s trail is unavailable, never zero hops', async (_n, answer) => {
    hopsAnswer = answer;
    const m = await mountPage();
    expect(rows(m)).toHaveLength(0);
    expect(text(m)).toContain('Step trail unavailable');
    expect(text(m)).not.toContain('No completed steps recorded');
  });

  it('an older server (no AppRun.hops) is unavailable and the rest of the page still renders', async () => {
    hopsError = true;
    const m = await mountPage();
    expect(text(m)).toContain('Step trail unavailable');
    expect(text(m)).toContain('Trigger');
  });

  it('a RUNNING run shows its current position apart from the rows; the last completed row is not marked live', async () => {
    runOver = { status: 'RUNNING', curNodeUrn: CURRENT, finishedAt: null };
    hopsAnswer = [hop({ edgeOut: 'next' })];
    const m = await mountPage();
    expect(rows(m)).toHaveLength(1);
    expect(rows(m)[0].textContent).not.toContain('summarise');
    expect(rows(m)[0].querySelector('.animate-pulse')).toBeNull();
    const cur = m.target.querySelector('[data-testid="timeline-current"]');
    expect(cur?.textContent).toContain('In progress at');
    expect(cur?.textContent).toContain('summarise');
  });

  it('a FAILED run shows the failed step separately from the rows (it has no element of its own)', async () => {
    runOver = { status: 'FAILED', curNodeUrn: CURRENT, failure: { code: 'EDGE_CONDITION_ERROR', message: 'boom' } };
    hopsAnswer = [hop()];
    const m = await mountPage();
    expect(rows(m)).toHaveLength(1);
    const cur = m.target.querySelector('[data-testid="timeline-current"]');
    expect(cur?.textContent).toContain('Failed at');
    expect(cur?.textContent).toContain('summarise');
  });

  it('a trail read for another run is never shown on this one (navigation pin)', async () => {
    hopsAnswer = [hop()];
    const m = await mountPage();
    expect(rows(m)).toHaveLength(1);
    const data = m.props.data as Record<string, unknown>;
    // Navigated to run-2 while run-1's poll answer is still the loaded trail.
    m.props.data = { ...data, run: { ...(data.run as Record<string, unknown>), id: 'run-2' } };
    await settle();
    expect(rows(m)).toHaveLength(0);
    expect(text(m)).toContain('Step trail unavailable');
  });

  it('a live poll that lands a new hop updates the rows', async () => {
    runOver = { status: 'RUNNING', curNodeUrn: CURRENT, finishedAt: null };
    hopsAnswer = [hop()];
    const m = await mountPage();
    expect(rows(m)).toHaveLength(1);
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, trail: { runId: 'run-1', supported: true, raw: [hop(), hop({ node: REPLY, edgeOut: null })] } };
    await settle();
    expect(rows(m)).toHaveLength(2);
  });
});
