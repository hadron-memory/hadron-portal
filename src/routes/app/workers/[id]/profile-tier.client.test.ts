import { afterEach, expect, it } from 'vitest';
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
  expect((await mountInternal(null)).textContent).toContain('Not reported');
});

it('#1492 renders no host label or prompt, and nothing raw for an unknown state', async () => {
  const text = (await mountInternal(terminalOf({ status: 'quantum', reason: 'solar_flare', host: { id: 'h1', label: 'HOSTLABEL' }, prompt: { text: 'SCREENTEXT' } }))).textContent!;
  expect(text).toContain('Unknown state');
  expect(text).toContain('Other reason');
  for (const secret of ['HOSTLABEL', 'SCREENTEXT', 'solar_flare', 'quantum']) expect(text).not.toContain(secret);
});

it('#1492 a stale report keeps its server state; a future checkedAt is time unknown', async () => {
  const stale = (await mountInternal(terminalOf({ status: 'busy', reason: null, checkedAt: '2026-10-01T00:00:00.000Z' }))).textContent!;
  expect(stale).toContain('Busy');
  expect(stale).not.toMatch(/Dark|Idle: /);
  cleanup?.();
  expect((await mountInternal(terminalOf({ checkedAt: '2027-01-01T00:00:00.000Z' }))).textContent).toContain('checked: time unknown');
});

it('#1492 the Profile tier shows no terminal, even if a terminal object arrives', () => {
  const m = mountComponent(Page as never, { data: { worker: { ...profile, terminal: terminalOf() }, initialTab: 'wake', terminalNow: NOW } } as never);
  cleanup = m.unmount;
  for (const s of ['Locked', 'Model at capacity', 'Not reported', 'Last turn']) expect(m.target.textContent).not.toContain(s);
});
