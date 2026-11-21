import { expect, it } from 'vitest';
import { profileWorker, workerInternalsVisible } from './worker-profile';
import type { Worker } from './types';
it('uses a server boolean, not App/Agent presence or a true-only liveness check', () => {
  expect(workerInternalsVisible({ hasLiveSession: false })).toBe(true);
  expect(workerInternalsVisible({ hasLiveSession: true })).toBe(true);
  expect(workerInternalsVisible({ hasLiveSession: null })).toBe(false);
  expect(workerInternalsVisible({})).toBe(false);
});
it('does not serialize working state into Profile loader data even when stale data carries it', () => {
  const worker = { id: 'w1', appId: 'app1', agentId: 'a1', name: 'Profile', role: null,
    createdAt: '2026-10-30', retiredAt: null, agent: null, hasLiveSession: null,
    appName: 'Team', ownerName: 'owner', app: { name: 'SECRET_APP' },
    memoryId: 'SECRET_MEMORY', prompt: 'SECRET_PROMPT', signature: 'SECRET_SIGNATURE',
    reportsTo: { name: 'SECRET_REPORT' }, heldByUserId: 'SECRET_HOLDER',
  } as unknown as Worker;
  const result = profileWorker(worker);
  expect(result.appName).toBe('Team'); expect(result.ownerName).toBe('owner');
  expect(JSON.stringify(result)).not.toContain('SECRET');
});
// portal#1491 — the Agent is its own read gate (the page's Details section
// shows it exactly when the server returns it), so it must SURVIVE the very
// projection that withholds the internals. The fixture conflicts on purpose:
// a worker whose internals ARE readable (boolean hasLiveSession, a live
// memory id) still gets the null sentinel — Profile never carries internals —
// while the authorized Agent projection passes through by reference, so a
// projection that dropped or nulled it fails here.
it('#1491 preserves the separately authorized Agent projection while returning the null-internals sentinel', () => {
  const agent = { id: 'agent-9', name: 'Details Agent', urn: 'hrn:agent:example.test:agent-9' };
  const worker = { id: 'w1', appId: 'app1', agentId: 'agent-9', name: 'Profile', role: null,
    createdAt: '2026-10-30', retiredAt: null, appName: 'Team', ownerName: 'owner',
    agent, memoryId: 'mem-live', hasLiveSession: true,
  } as unknown as Worker;
  const result = profileWorker(worker);
  expect(result.agent).toBe(agent);
  expect(result.hasLiveSession).toBeNull();
  expect(result.memoryId).toBeNull();
});
