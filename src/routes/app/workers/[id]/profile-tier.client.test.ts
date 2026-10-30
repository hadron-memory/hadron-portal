import { afterEach, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import Page from './+page.svelte';
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
