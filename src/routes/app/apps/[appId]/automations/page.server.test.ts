/**
 * portal#1299 — the Automations list loader (automation approval S3). The
 * server decides who may see which automation (hadron-server#2441): a caller
 * who may not adopt gets an empty page or a FORBIDDEN refusal, and the portal
 * shows both as the same nothing. Only a refusal is concealed; any other
 * failure stays a failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { AUTOMATION_APPROVALS_QUERY } from '$lib/server/automation-approval';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });
const MANUAL = { triggerKind: 'MANUAL', reason: 'approved from the run that needs it' };
const row = (over: Record<string, unknown> = {}) => ({
  triggerKind: 'SCHEDULE', triggerRef: 'sch-1', name: 'Nightly digest', state: 'UNADOPTED',
  headline: 'Nightly digest: Runs on the schedule "0 6 * * *" (UTC); waiting for approval', ...over,
});

beforeEach(() => { request.mockReset(); });

async function loadList(search = '') {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/apps/app-1/automations${search}`),
  } as never)) as Record<string, unknown>;
}
const answer = (page: unknown) => async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { automationApprovals: page });

describe('list loader', () => {
  it('reads the App’s page and carries the server’s rows, cursor and omission as sent', async () => {
    const page = { rows: [row(), row({ triggerRef: 'wh-1', triggerKind: 'WEBHOOK', state: 'ADOPTED' })], nextCursor: 'c1', omitted: [MANUAL] };
    request.mockImplementation(answer(page));
    const r = await loadList();
    expect(r.approvals).toEqual({ kind: 'ok', ...page });
    const call = request.mock.calls.find((c) => c[0] === AUTOMATION_APPROVALS_QUERY)!;
    expect(call[1]).toEqual({ appRef: 'app-1', after: null });
  });

  it('passes the cursor from the URL back to the server untouched', async () => {
    request.mockImplementation(answer({ rows: [], nextCursor: null, omitted: [MANUAL] }));
    await loadList('?after=abc_-123');
    expect(request.mock.calls.find((c) => c[0] === AUTOMATION_APPROVALS_QUERY)![1]).toEqual({ appRef: 'app-1', after: 'abc_-123' });
  });

  it.each(['?after=a%25b', '?after=' + 'x'.repeat(513)])('a cursor the server could not have sent (%#) is a 400 in words a person can read, and asks nothing', async (search) => {
    request.mockImplementation(answer({ rows: [], nextCursor: null, omitted: [MANUAL] }));
    await expect(loadList(search)).rejects.toMatchObject({ status: 400, body: { message: 'That page of automations does not exist.' } });
    expect(request.mock.calls.find((c) => c[0] === AUTOMATION_APPROVALS_QUERY)).toBeUndefined();
  });

  it('an empty ?after= is the first page', async () => {
    request.mockImplementation(answer({ rows: [], nextCursor: null, omitted: [MANUAL] }));
    await loadList('?after=');
    expect(request.mock.calls.find((c) => c[0] === AUTOMATION_APPROVALS_QUERY)![1]).toEqual({ appRef: 'app-1', after: null });
  });

  it('a caller the server refuses (FORBIDDEN) gets the same empty answer as a caller with nothing to approve', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw gqlError('FORBIDDEN'); });
    const refused = await loadList();
    request.mockImplementation(answer({ rows: [], nextCursor: null, omitted: [MANUAL] }));
    const empty = await loadList();
    expect(refused.approvals).toEqual({ kind: 'ok', rows: [], nextCursor: null, omitted: [MANUAL] });
    expect(refused.approvals).toEqual(empty.approvals);
  });

  it('an unexpected failure is not an empty list', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw gqlError('INTERNAL_SERVER_ERROR'); });
    await expect(loadList()).rejects.toMatchObject({ response: { errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    // A transport failure is a ClientError with a response and no errors payload.
    const transport = { message: '502 Bad Gateway', response: { status: 502 } };
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw transport; });
    await expect(loadList()).rejects.toBe(transport);
  });

  it('a viewer who cannot see the App gets the App page’s 404', async () => {
    request.mockRejectedValueOnce(gqlError('NOT_FOUND'));
    await expect(loadList()).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a row whose state the list cannot hold: CHANGED is computed on open, never listed', async () => {
    request.mockImplementation(answer({ rows: [row({ state: 'CHANGED' })], nextCursor: null, omitted: [MANUAL] }));
    await expect(loadList()).rejects.toBeTruthy();
  });

  it('exports no form actions: the list only reads', async () => {
    expect('actions' in (await import('./+page.server'))).toBe(false);
  });
});
