/**
 * portal#1299 — the approval page's loader and its two actions (automation
 * approval S3). Approve sends the hash the page showed and nothing else; a
 * stale hash is shown, never retried; Decline sends kind and ref only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { APPROVE_AUTOMATION_MUTATION, AUTOMATION_APPROVAL_QUERY, DECLINE_AUTOMATION_MUTATION } from '$lib/server/automation-approval';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string, message = code) => ({ response: { errors: [{ message, extensions: { code } }] } });
const approval = (over: Record<string, unknown> = {}) => ({
  state: 'UNADOPTED', hash: 'hash-1', depth: { entryId: 'n1' },
  summary: { name: 'Nightly digest', schedule: 'Runs daily.', reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] }, ...over,
});

beforeEach(() => { request.mockReset(); });

const locals = { token: 'tok', user: { id: 'u1' }, impersonation: null };
async function loadDetail(kind = 'schedule', ref = 'sch-1') {
  const { load } = await import('./+page.server');
  return (await load({ params: { appId: 'app-1', kind, ref }, locals, url: new URL('http://localhost/x') } as never)) as Record<string, unknown>;
}
async function act(name: 'approve' | 'decline', fields: Record<string, string>, kind = 'schedule', ref = 'sch-1') {
  const { actions } = await import('./+page.server');
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const request_ = new Request('http://localhost/x', { method: 'POST', body });
  return (await (actions as Record<string, (e: never) => Promise<unknown>>)[name]({ request: request_, params: { appId: 'app-1', kind, ref }, locals } as never)) as { status?: number; data?: Record<string, unknown> } | Record<string, unknown>;
}
const mutations = () => request.mock.calls.filter((c) => c[0] === APPROVE_AUTOMATION_MUTATION || c[0] === DECLINE_AUTOMATION_MUTATION);

describe('loader', () => {
  it('reads one trigger’s approval by the kind and id in the URL', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { automationApproval: approval() }));
    const r = await loadDetail('webhook', 'wh-9');
    expect(r.approval).toEqual(approval());
    expect(request.mock.calls.find((c) => c[0] === AUTOMATION_APPROVAL_QUERY)![1]).toEqual({ triggerKind: 'WEBHOOK', triggerRef: 'wh-9' });
  });

  it('a null approval is the same 404, not a render that throws', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { automationApproval: null }));
    await expect(loadDetail()).rejects.toMatchObject({ status: 404 });
  });

  it('an unknown kind in the URL is a 404 and asks the server nothing', async () => {
    await expect(loadDetail('cron', 'x')).rejects.toMatchObject({ status: 404 });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['FORBIDDEN', 'NOT_FOUND'])('%s is the same 404: a reader who may not adopt learns nothing', async (code) => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw gqlError(code); });
    await expect(loadDetail()).rejects.toMatchObject({ status: 404 });
  });

  it('any other failure stays a failure', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw gqlError('INTERNAL_SERVER_ERROR'); });
    await expect(loadDetail()).rejects.toMatchObject({ response: expect.anything() });
  });
});

describe('approve', () => {
  it('sends the hash the page showed, with the trigger from the URL', async () => {
    request.mockResolvedValue({ approveAutomation: true });
    const r = await act('approve', { expectedHash: 'hash-1' }, 'webhook', 'wh-9');
    expect(mutations()).toEqual([[APPROVE_AUTOMATION_MUTATION, { triggerKind: 'WEBHOOK', triggerRef: 'wh-9', expectedHash: 'hash-1' }]]);
    expect(r).toMatchObject({ approved: true });
  });

  it('a form carrying a different trigger cannot redirect the approval', async () => {
    request.mockResolvedValue({ approveAutomation: true });
    await act('approve', { expectedHash: 'hash-1', triggerKind: 'WEBHOOK', triggerRef: 'other' });
    expect(mutations()[0][1]).toEqual({ triggerKind: 'SCHEDULE', triggerRef: 'sch-1', expectedHash: 'hash-1' });
  });

  it('refuses a missing hash before any call', async () => {
    const r = await act('approve', { expectedHash: '  ' });
    expect(r).toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it('a stale hash (AUTOMATION_CHANGED) is reported as stale and makes exactly one mutation call, never a retry', async () => {
    request.mockRejectedValue(gqlError('AUTOMATION_CHANGED', 'Automation changed since preview; preview and re-adopt again.'));
    const r = (await act('approve', { expectedHash: 'old' })) as { status: number; data: { code: string } };
    expect(r.status).toBe(409);
    expect(r.data.code).toBe('stale');
    expect(mutations()).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a refusal (FORBIDDEN) is shown with the server’s own words, as a failure', async () => {
    request.mockRejectedValue(gqlError('FORBIDDEN', 'You cannot read a memory this automation uses, so you cannot preview or adopt it.'));
    const r = (await act('approve', { expectedHash: 'h' })) as { status: number; data: { code: string; message: string } };
    expect(r.status).toBe(403);
    expect(r.data.code).toBe('refused');
    expect(r.data.message).toContain('You cannot read a memory');
  });

  it('an unexpected failure is rethrown, not turned into a message', async () => {
    request.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR'));
    await expect(act('approve', { expectedHash: 'h' })).rejects.toBeTruthy();
  });
});

describe('decline', () => {
  it('sends the trigger kind and id only: no hash, even if the form carries one', async () => {
    request.mockResolvedValue({ declineAutomation: true });
    const r = await act('decline', { expectedHash: 'hash-1' }, 'webhook', 'wh-9');
    expect(mutations()).toEqual([[DECLINE_AUTOMATION_MUTATION, { triggerKind: 'WEBHOOK', triggerRef: 'wh-9' }]]);
    expect(r).toMatchObject({ declined: true });
  });

  it('a refusal is a failure with the server’s words; anything else is rethrown', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Only the run-as user may preview and re-adopt this automation.'));
    expect(await act('decline', {})).toMatchObject({ status: 403 });
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    await expect(act('decline', {})).rejects.toBeTruthy();
  });
});
