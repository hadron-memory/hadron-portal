import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { updateSignatureSchema } from './schema';
const profile = {
  id: 'w-profile', appId: 'app-1', agentId: 'agent-1', name: 'Profile Worker', slug: 'profile-worker',
  urn: 'hrn:worker:example.test:team:profile-worker', portalUrl: 'https://example.test/app/workers/w-profile',
  role: 'engineer', appUrn: 'hrn:app:example.test:team', appName: 'Public Team', ownerName: 'owner-atom',
  createdAt: '2026-10-30T00:00:00Z', retiredAt: null, hasLiveSession: null, agent: null,
  // The presentation boundary must not render these even if stale data carries them.
  prompt: 'SECRET PROMPT', memoryId: 'secret-memory', signature: 'SECRET SIGNATURE',
  app: { id: 'app-1', name: 'NESTED APP', urn: 'hrn:app:example.test:team' },
};
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); });
it('#1334 renders Profile identity only, with no Agent placeholder or working-state tabs', () => {
  const m = mountComponent(Page as never, { data: { worker: profile, initialTab: 'wake' } } as never); cleanup = m.unmount;
  expect(m.target.textContent).toContain('Profile Worker');
  expect(m.target.textContent).toContain('Public Team');
  expect(m.target.textContent).toContain('owner-atom');
  expect(m.target.textContent).not.toContain('NESTED APP');
  expect(m.target.textContent).not.toContain('SECRET');
  expect(m.target.textContent).not.toContain('Working memory');
  expect(m.target.textContent).not.toContain('Backed by');
  expect(m.target.querySelector('[role="tablist"]')).toBeNull();
  expect(m.target.querySelector('form')).toBeNull();
});

// portal#1491 — this page's tier boundary used to be pinned red only by a
// fixture crash: a pre-fix page asked for its wake tab with NO wake data and
// died in WakeUpsPanel, which proves nothing about exposure. The payload
// below seeds everything the OLD page needed — a valid ok wake read, a
// session row, management rights, the real signature form and every result
// key — so a page with the Profile branch removed RENDERS and fails the
// assertions on exposed tabs, forms and content instead.
const fullOldPagePayload = async () => {
  const signatureForm = await superValidate({}, zod4(updateSignatureSchema), { errors: false });
  return {
    worker: { ...profile },
    initialTab: 'wake',
    initialView: null,
    leaveAloneByHandle: null,
    terminalNow: NOW,
    signatureForm,
    wake: { kind: 'ok', value: { mentions: '@gil', pausedUntil: null, dormant: false, effectiveCadenceSeconds: 900, subscriptions: [] } },
    wakeAppSettings: null,
    wakeLoadedAt: NOW,
    workerSessions: [{ id: 's-1', type: 'github', repo: 'acme/app', branch: 'main', tool: null, host: null, llmModel: null, plan: null, summary: 'Old-page session row', prNumber: null, turnCount: 1, errorCount: 0 }],
    sessionsTruncated: false,
    worklog: null,
    worklogTotal: 0,
    bootPointer: { ok: false as const },
    canManageWorkerApp: true,
    canChangeAgent: false,
    changeAgentOptions: [],
    changeAgentKey: 'w-profile',
    retireKey: 'w-profile',
    bootPointerKey: 'w-profile',
    applyKey: 'w-profile',
  };
};
it('#1491 renders Profile identity only from a payload the old page renders in full', async () => {
  const m = mountComponent(Page as never, { data: await fullOldPagePayload() } as never); cleanup = m.unmount;
  const text = m.target.textContent ?? '';
  expect(text).toContain('Profile Worker');
  // Each absence below is a surface the pre-fix page rendered FROM THIS
  // PAYLOAD — so removing the Profile branch fails here on content, not on a
  // WakeUpsPanel exception (the crash the old fixture proved instead).
  expect(m.target.querySelector('[role="tablist"]')).toBeNull();            // the tabs
  expect(m.target.querySelector('form')).toBeNull();                        // management's (hidden) retire form
  expect(m.target.querySelector('#panel-wake')).toBeNull();                 // the requested wake tabpanel
  expect(m.target.querySelector('[data-testid="wake-panel"]')).toBeNull();  // the ok wake read
  expect(text).not.toContain('NESTED APP');                                 // the breadcrumb from worker.app
  expect(text).not.toContain('@gil');                                       // the wake settings content
  expect(text).not.toContain('SECRET');
});
it('#1491 control: the same payload under a participant renders every surface the Profile pin forbids', async () => {
  const payload = await fullOldPagePayload();
  const m = mountComponent(Page as never, { data: { ...payload, worker: { ...payload.worker, hasLiveSession: false } } } as never); cleanup = m.unmount;
  const text = m.target.textContent ?? '';
  expect(m.target.querySelector('[role="tablist"]')).not.toBeNull();
  expect(m.target.querySelector('form')).not.toBeNull();
  expect(m.target.querySelector('#panel-wake')).not.toBeNull();
  expect(m.target.querySelector('[data-testid="wake-panel"]')).not.toBeNull();
  expect(text).toContain('NESTED APP');
  expect(text).toContain('@gil');
});
it('#1334 Details shows Agent only when the server returns it, without working-state panels', () => {
  const m = mountComponent(Page as never, { data: { worker: { ...profile, agent: { id: 'agent-1', name: 'Visible Agent', urn: 'hrn:agent:example.test:agent' } } } } as never); cleanup = m.unmount;
  expect(m.target.textContent).toContain('Visible Agent');
  expect(m.target.querySelector('[role="tablist"]')).toBeNull();
});

it('#1334 unbound participants keep full panels even with masked App and Agent', async () => {
  const signatureForm = await superValidate({}, zod4(updateSignatureSchema), { errors: false });
  const m = mountComponent(Page as never, { data: { worker: { ...profile, hasLiveSession: false, app: null, prompt: null }, initialTab: 'profile', signatureForm } } as never); cleanup = m.unmount;
  expect(m.target.querySelector('[role="tablist"]')).not.toBeNull();
  expect(m.target.textContent).toContain('Working memory');
  expect(m.target.textContent).not.toContain('Backed by');
  expect(m.target.textContent).not.toContain('Agent no longer installed');
});

// portal#1492 (PT1) — the worker page's terminal status, internal tier only.
const NOW = '2026-10-31T12:00:00.000Z';
const terminalOf = (over: Record<string, unknown> = {}) =>
  ({ status: 'locked', reason: 'model_at_capacity', checkedAt: '2026-10-31T11:55:00.000Z', lastTurnAt: null, ...over });
async function mountInternal(terminal: unknown, extra: Record<string, unknown> = {}) {
  const signatureForm = await superValidate({}, zod4(updateSignatureSchema), { errors: false });
  const m = mountComponent(Page as never, {
    data: { worker: { ...profile, hasLiveSession: false, terminal, ...extra }, initialTab: 'profile', signatureForm, terminalNow: NOW },
  } as never);
  cleanup = m.unmount;
  return m.target;
}

it('#1492 shows the state, the reason in words, the last turn and the check age', async () => {
  const text = (await mountInternal(terminalOf())).textContent!;
  expect(text).toContain('Locked');
  expect(text).toContain('Model at capacity');
  expect(text).toContain('Last turn: not known');
  expect(text).toMatch(/checked .*ago/);
  expect(text).not.toContain('model_at_capacity');
});

it('#1492 a last turn with a value reads as an age; a returned null is Not reported', async () => {
  const withTurn = (await mountInternal(terminalOf({ lastTurnAt: '2026-10-31T11:00:00.000Z' }))).textContent!;
  expect(withTurn).toMatch(/Last turn: .*ago/);
  expect(withTurn).not.toContain('not known');
  const unreported = (await mountInternal(null)).textContent!;
  expect(unreported).toContain('Not reported');
  // portal#1495 (BLIND hygiene): the not-reported guard in the FULL form was
  // untested — deleting it would have rendered "Last turn: not known" and
  // "checked: time unknown" under a report that says none of that.
  expect(unreported).not.toContain('Last turn');
  expect(unreported).not.toContain('checked');
});

it('#1492 renders no host label or prompt, and nothing raw for an unknown state', async () => {
  const text = (await mountInternal(terminalOf({ status: 'quantum', reason: 'solar_flare', host: { id: 'h1', label: 'HOSTLABEL' }, prompt: { text: 'SCREENTEXT' } }))).textContent!;
  expect(text).toContain('Unknown state');
  expect(text).toContain('Other reason');
  for (const secret of ['HOSTLABEL', 'SCREENTEXT', 'solar_flare', 'quantum']) expect(text).not.toContain(secret);
});

it('#1948 an old report shows Stale without status or reason; a future checkedAt stays unknown', async () => {
  const stale = (await mountInternal(terminalOf({ status: 'idle', reason: 'model_at_capacity', checkedAt: '2026-10-31T04:00:00.000Z' }))).textContent!;
  expect(stale).toContain('Stale');
  expect(stale).toMatch(/checked .*8.*ago/);
  expect(stale).not.toMatch(/Busy|Dark|Idle|Model at capacity/);
  cleanup?.();
  expect((await mountInternal(terminalOf({ checkedAt: '2027-01-01T00:00:00.000Z' }))).textContent).toContain('checked: time unknown');
});

it('#1495 P2 a checkedAt a moment ahead of the page clock reads as checked now, never future wording', async () => {
  const skew = (await mountInternal(terminalOf({ checkedAt: '2026-10-31T12:00:30.000Z' }))).textContent!; // 30 s ahead of NOW
  expect(skew).toContain('checked now');
  expect(skew).not.toMatch(/in \d+ sec/);
});

it('#1495 P3 the full form advances with the page clock, and teardown stops it', async () => {
  vi.useFakeTimers();
  const target = await mountInternal(terminalOf());
  expect(target.textContent).toContain('checked 5 min. ago');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(target.textContent).toContain('checked 6 min. ago');
  // Teardown: the DOM is detached but live, so a leaked interval would keep writing.
  cleanup?.();
  const frozen = target.textContent;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(target.textContent).toBe(frozen);
  vi.useRealTimers();
});

// portal#1495 BLIND P3 (George) — the frozen-DOM check above passes even with
// a leaked interval (effects are disposed after unmount, so nothing renders).
// The fake-timer count proves the interval itself was cleared: one interval
// while mounted, back to the pre-mount baseline after teardown.
it('#1495 BLIND teardown clears the clock interval itself, not just its DOM writes', async () => {
  vi.useFakeTimers();
  const baseline = vi.getTimerCount();
  const target = await mountInternal(terminalOf());
  expect(target.textContent).toContain('checked 5 min. ago');
  expect(vi.getTimerCount()).toBe(baseline + 1); // the one clock interval
  cleanup?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(baseline);
  vi.useRealTimers();
});

it('#1492 the Profile tier shows no terminal, even if a terminal object arrives', () => {
  const m = mountComponent(Page as never, { data: { worker: { ...profile, terminal: terminalOf() }, initialTab: 'wake', terminalNow: NOW } } as never);
  cleanup = m.unmount;
  for (const s of ['Locked', 'Model at capacity', 'Not reported', 'Last turn']) expect(m.target.textContent).not.toContain(s);
});


it('#1948 worker badge becomes Stale when its display clock crosses thirty minutes', async () => {
  vi.useFakeTimers();
  try {
    const target=await mountInternal(terminalOf({status:'idle',reason:null,checkedAt:'2026-10-31T11:30:00.000Z'}));
    expect(target.textContent).toContain('Idle');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(target.textContent).toContain('Stale');
    expect(target.textContent).not.toContain('Idle');
  } finally { cleanup?.(); vi.useRealTimers(); }
});
