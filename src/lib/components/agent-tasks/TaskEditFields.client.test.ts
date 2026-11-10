/**
 * portal#1530 — the min-tier help must state that the unknown-tier exclusion
 * applies only when a minimum is selected (the server matcher excludes
 * unknown-tier workers solely for a task with a minTier; with "Any" they stay
 * eligible, sorted last). The same key/default is used by the create page,
 * pinned there too; this file pins the Edit panel's copy and the unchanged
 * `minTier` serialization beside its base.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { MIN_TIER_HELP } from '$lib/test/minTierHelp';
import TaskEditFields from './TaskEditFields.svelte';

const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const task = (minTier: string | null) => ({
  id: 't1', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'PENDING', queued: false, waitingOnChildren: false,
  source: 'https://example.com/x', owner: holger, assignee: null, startBy: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: null, tags: [],
  description: null,
  requirements: { role: null, familyIn: [], familyNotIn: [], excludeWorkerIds: [], minTier },
  createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null,
  startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: false, result: null, sessionEndRequest: null,
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountFields(minTier: string | null) {
  const m = mountComponent(TaskEditFields as never, {
    task: task(minTier), workers: [], roles: [], families: [], invalid: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target as HTMLElement;
}

describe('TaskEditFields min-tier help (portal#1530)', () => {
  it('with "Any" selected, qualifies the exclusion to a selected minimum and serializes no minimum', async () => {
    const root = await mountFields(null);
    expect(root.querySelector('#edit-min-tier-help')!.textContent).toBe(MIN_TIER_HELP);
    const select = root.querySelector<HTMLSelectElement>('#edit-min-tier')!;
    expect(select.value).toBe('');
    const base = JSON.parse(root.querySelector<HTMLInputElement>('[name="requirementsBase"]')!.value);
    expect(base.minTier).toBe(null);
  });

  it('with a minimum selected, shows the same sentence and serializes the tier beside its base', async () => {
    const root = await mountFields('mid');
    expect(root.querySelector('#edit-min-tier-help')!.textContent).toBe(MIN_TIER_HELP);
    const select = root.querySelector<HTMLSelectElement>('#edit-min-tier')!;
    expect(select.value).toBe('mid');
    const base = JSON.parse(root.querySelector<HTMLInputElement>('[name="requirementsBase"]')!.value);
    expect(base.minTier).toBe('mid');
  });
});
