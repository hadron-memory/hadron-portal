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
