/**
 * portal#1462 — the worker page's apply result, through the real Page
 * (George's P2-1 on #1464). The loader accepts a worker REFERENCE, so the
 * route may spell the worker as its URN while the loaded worker carries its
 * id. The action keys its result with the route's spelling, and the page must
 * hand the panel that same identity: a result the reader just caused may never
 * vanish because the two spellings differ.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureSchema } from './schema';
import Page from './+page.svelte';

const URN = 'hrn:worker:a.com:team:w-a';
const worker = {
  id: 'uuid-a', appId: 'app-1', agentId: 'agent-1', name: 'Worker A', slug: 'w-a', urn: URN,
  role: 'engineer', prompt: 'P', memoryId: null, retiredAt: null, heldByUserId: null, heldAt: null, createdAt: '1789430400000',
  agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:a.com:engineer' },
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:a.com:team', organizationId: 'org-1' },
};
async function data(applyKey: string) {
  return {
    worker, user: { id: 'u1' },
    signatureForm: await superValidate({}, zod4(updateSignatureSchema), { errors: false }),
    initialTab: 'wake', initialView: null,
    workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
    wake: { kind: 'ok', value: { mentions: 'IMMEDIATE', pausedUntil: null, dormant: false, effectiveCadenceSeconds: null, subscriptions: [] } },
    wakeAppSettings: { kind: 'ok', value: { minCadenceSeconds: 300, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 4320, dailyWakeBudgetDerived: true } },
    wakeLoadedAt: '2026-10-30T12:00:00Z',
    bootPointer: { ok: true, ref: null, deleted: null },
    canManageWorkerApp: true,
    bootPointerKey: worker.id,
    applyKey,
  };
}
const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationGuards();
  setStubPage(`https://example.test/app/workers/${URN}?tab=wake`, { id: URN });
});
async function mountPage(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}

describe('Worker page: apply result identity (URN route)', () => {
  it('a success the action keyed with the route’s URN shows, though the worker loads as its id', async () => {
    const root = await mountPage({
      data: await data(URN),
      form: { applyTickers: { key: URN, ok: true, created: [{ tickerId: 'k1', tickerName: 'Heartbeat · w-a', tickerUrn: null, templateId: 't1', templateName: 'Heartbeat', effectiveCadenceSeconds: 600 }], alreadyPresent: [] } },
    });
    expect(root.querySelector('[data-testid="apply-receipt"]')?.textContent).toContain('Heartbeat · w-a');
  });

  it('a typed refusal keyed with the route’s URN shows too', async () => {
    const root = await mountPage({
      data: await data(URN),
      form: { applyTickers: { key: URN, refusal: { code: 'TICKER_LIMIT_REACHED', message: 'Nothing was created: …', outcomeUnknown: false } } },
    });
    expect(root.querySelector('[data-testid="apply-refusal"]')?.textContent).toContain('TICKER_LIMIT_REACHED');
  });

  it('the canonical-id spelling still shows (the control)', async () => {
    const root = await mountPage({
      data: await data('uuid-a'),
      form: { applyTickers: { key: 'uuid-a', ok: true, created: [], alreadyPresent: [{ id: 't', name: 'Heartbeat' }] } },
    });
    expect(root.querySelector('[data-testid="apply-receipt"]')).not.toBeNull();
  });

  it('a result written for another route is not shown', async () => {
    const root = await mountPage({ data: await data(URN), form: { applyTickers: { key: 'hrn:worker:a.com:team:w-b', ok: true, created: [], alreadyPresent: [] } } });
    expect(root.querySelector('[data-testid="apply-receipt"]')).toBeNull();
  });
});
