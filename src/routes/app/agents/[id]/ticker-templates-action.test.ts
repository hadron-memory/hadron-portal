/**
 * portal#1609 (slice C of #1141) — the Agent page's template actions. Each
 * write goes with the viewer's own token (never a service key), sends only
 * what the reader changed with the revision the page read, never a null, never
 * `[]`, and renders the server's refusal; nothing is retried. A support
 * session writes nothing. The `viewerMayEditTickerTemplates` hint is not
 * consulted here: the server is the authority.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TICKER_TEMPLATES_QUERY,
  CREATE_AGENT_TICKER_TEMPLATE_MUTATION,
  DELETE_AGENT_TICKER_TEMPLATE_MUTATION,
  UPDATE_AGENT_TICKER_TEMPLATE_MUTATION,
} from '$lib/server/agent-ticker-templates';
import { IMPERSONATION_SENTENCE } from '$lib/server/agent-task-writes';

const request = vi.fn();
const gqlClientFor = vi.fn((_token?: string) => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (token?: string) => gqlClientFor(token) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({});
  gqlClientFor.mockClear();
});

const gqlError = (code: string, message = code) => ({ response: { errors: [{ message, extensions: { code } }] } });

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
type Name = 'createTickerTemplate' | 'updateTickerTemplate' | 'deleteTickerTemplate';
async function run(name: Name, form: FormData, locals: Record<string, unknown> = {}) {
  const { actions } = await import('./+page.server');
  return (await actions[name]({
    request: { formData: async () => form },
    params: { id: 'agent-1' },
    locals: { token: 'viewer-tok', impersonation: null, ...locals },
  } as never)) as { status?: number; data?: { action: string; refusal: { kind: string; code?: string; message?: string; field?: string } } } | { action: string; ok: true };
}
const failure = (r: unknown) => r as { status: number; data: { action: string; refusal: { kind: string; code?: string; message?: string } } };
const sent = (doc: string) => request.mock.calls.filter(([d]) => d === doc);

const storedEdit = { id: 'tpl-1', expectedRevision: '4', nameWas: 'standup', cadenceSecondsWas: '600', reasonsShown: '1', reasonsWas: 'READ_TEAM_CHANNEL', name: 'standup', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL'] };

describe('the template actions exist beside the page’s others', () => {
  it('exports exactly the three new template actions', async () => {
    const { actions } = await import('./+page.server');
    for (const n of ['createTickerTemplate', 'updateTickerTemplate', 'deleteTickerTemplate']) expect(typeof (actions as Record<string, unknown>)[n]).toBe('function');
  });
});

describe('createTickerTemplate', () => {
  it('sends agentRef, name, cadence and an explicit reasons set with the viewer’s own token', async () => {
    const r = await run('createTickerTemplate', fd({ name: ' standup ', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL', 'LIVE_CHECK'] }));
    expect(r).toEqual({ action: 'createTickerTemplate', ok: true });
    expect(sent(CREATE_AGENT_TICKER_TEMPLATE_MUTATION)).toHaveLength(1);
    expect(sent(CREATE_AGENT_TICKER_TEMPLATE_MUTATION)[0][1]).toEqual({
      agentRef: 'agent-1',
      input: { name: 'standup', cadenceSeconds: 600, reasons: ['READ_TEAM_CHANNEL', 'LIVE_CHECK'] },
    });
    expect(gqlClientFor).toHaveBeenCalledWith('viewer-tok');
    expect(gqlClientFor.mock.calls.every(([t]) => t === 'viewer-tok')).toBe(true);
  });

  it('empty reasons or a bad cadence is refused with nothing sent', async () => {
    const a = failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '60' })));
    expect(a.status).toBe(400);
    expect(a.data.refusal).toMatchObject({ kind: 'invalid', field: 'reasons' });
    expect(failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '1.5', reasons: ['EVERY_TICK'] }))).data.refusal).toMatchObject({ field: 'cadenceSeconds' });
    expect(request).not.toHaveBeenCalled();
  });

  it('shows the server sentence for a typed refusal, and keeps the typed values to put back', async () => {
    request.mockRejectedValueOnce(gqlError('TICKER_TEMPLATE_LIMIT_REACHED', 'An Agent can have at most 20 templates.'));
    const r = failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK'] })));
    expect(r.data.refusal).toEqual({ kind: 'refused', code: 'TICKER_TEMPLATE_LIMIT_REACHED', message: 'An Agent can have at most 20 templates.' });
    expect((r.data as { values?: Record<string, unknown> }).values).toMatchObject({ name: 'a', cadenceSeconds: '60' });
  });

  it('a forged non-editor create is the server’s FORBIDDEN, rendered as the Agent sentence and never as success', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
    const r = failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK'] })));
    expect(r.status).toBe(403);
    expect(r.data.refusal.message).toMatch(/manages the Agent/);
    expect(r.data.refusal.message).not.toBe('Forbidden');
  });

  it('an unknown code or a transport failure is uncertain (502) and is not retried', async () => {
    request.mockRejectedValueOnce(gqlError('SOMETHING_NEW'));
    expect(failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK'] }))).status).toBe(502);
    request.mockReset();
    request.mockRejectedValueOnce(new Error('socket hang up'));
    const r = failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK'] })));
    expect(r.data.refusal.kind).toBe('uncertain');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a support session writes nothing and says why', async () => {
    const r = failure(await run('createTickerTemplate', fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK'] }), { impersonation: { id: 'x' } }));
    expect(r.data.refusal).toEqual({ kind: 'refused', code: 'FORBIDDEN', message: IMPERSONATION_SENTENCE });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('updateTickerTemplate', () => {
  it('sends only the changed field, with the revision the page read', async () => {
    await run('updateTickerTemplate', fd({ ...storedEdit, name: 'daily' }));
    expect(sent(UPDATE_AGENT_TICKER_TEMPLATE_MUTATION)).toHaveLength(1);
    expect(sent(UPDATE_AGENT_TICKER_TEMPLATE_MUTATION)[0][1]).toEqual({ id: 'tpl-1', expectedRevision: 4, input: { name: 'daily' } });
  });

  it('no change sends nothing', async () => {
    const r = failure(await run('updateTickerTemplate', fd(storedEdit)));
    expect(r.data.refusal).toMatchObject({ kind: 'invalid', field: 'form' });
    expect(request).not.toHaveBeenCalled();
  });

  it('removing quiet hours sends clearQuietHours: true and no null anywhere', async () => {
    await run('updateTickerTemplate', fd({ ...storedEdit, clearQuietHours: '1' }));
    const [, vars] = sent(UPDATE_AGENT_TICKER_TEMPLATE_MUTATION)[0];
    expect(vars).toEqual({ id: 'tpl-1', expectedRevision: 4, input: { clearQuietHours: true } });
    expect(JSON.stringify(vars)).not.toContain('null');
  });

  it('a stale revision is the portal sentence with the code, and the action does not re-read or retry', async () => {
    request.mockRejectedValueOnce(gqlError('TICKER_TEMPLATE_REVISION_MISMATCH', 'raw server words'));
    const r = failure(await run('updateTickerTemplate', fd({ ...storedEdit, name: 'daily' })));
    expect(r.status).toBe(400);
    expect(r.data.refusal).toMatchObject({ kind: 'refused', code: 'TICKER_TEMPLATE_REVISION_MISMATCH' });
    expect(r.data.refusal.message).not.toContain('raw server words');
    expect(request).toHaveBeenCalledTimes(1);
    expect(sent(AGENT_TICKER_TEMPLATES_QUERY)).toHaveLength(0);
  });

  it('a forged update of another Agent’s template is the server’s FORBIDDEN, never success', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
    const r = failure(await run('updateTickerTemplate', fd({ ...storedEdit, id: 'someone-elses', name: 'daily' })));
    expect(r.status).toBe(403);
    expect(sent(UPDATE_AGENT_TICKER_TEMPLATE_MUTATION)[0][1]).toMatchObject({ id: 'someone-elses' });
  });

  it('a missing revision sends nothing', async () => {
    const f = fd({ ...storedEdit, name: 'daily' });
    f.delete('expectedRevision');
    expect(failure(await run('updateTickerTemplate', f)).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('a support session writes nothing', async () => {
    const r = failure(await run('updateTickerTemplate', fd({ ...storedEdit, name: 'daily' }), { impersonation: { id: 'x' } }));
    expect(r.data.refusal.message).toBe(IMPERSONATION_SENTENCE);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('deleteTickerTemplate', () => {
  it('names the template and the revision the page read', async () => {
    const r = await run('deleteTickerTemplate', fd({ id: 'tpl-1', expectedRevision: '4' }));
    expect(r).toEqual({ action: 'deleteTickerTemplate', ok: true });
    expect(sent(DELETE_AGENT_TICKER_TEMPLATE_MUTATION)[0][1]).toEqual({ id: 'tpl-1', expectedRevision: 4 });
  });

  it('goes with the viewer’s own token, as do an update and a create', async () => {
    await run('deleteTickerTemplate', fd({ id: 'tpl-1', expectedRevision: '4' }));
    await run('updateTickerTemplate', fd({ ...storedEdit, name: 'daily' }));
    expect(gqlClientFor.mock.calls.length).toBe(2);
    expect(gqlClientFor.mock.calls.every(([t]) => t === 'viewer-tok')).toBe(true);
  });

  it('a missing id or revision sends nothing', async () => {
    expect(failure(await run('deleteTickerTemplate', fd({ id: 'tpl-1' }))).status).toBe(400);
    expect(failure(await run('deleteTickerTemplate', fd({ expectedRevision: '4' }))).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('a stale revision is refused with its code and not retried; FORBIDDEN is the Agent sentence', async () => {
    request.mockRejectedValueOnce(gqlError('TICKER_TEMPLATE_REVISION_MISMATCH'));
    expect(failure(await run('deleteTickerTemplate', fd({ id: 'tpl-1', expectedRevision: '4' }))).data.refusal).toMatchObject({ code: 'TICKER_TEMPLATE_REVISION_MISMATCH' });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset();
    request.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
    expect(failure(await run('deleteTickerTemplate', fd({ id: 'tpl-1', expectedRevision: '4' }))).data.refusal.message).toMatch(/Agent/);
  });

  it('a support session deletes nothing', async () => {
    await run('deleteTickerTemplate', fd({ id: 'tpl-1', expectedRevision: '4' }), { impersonation: { id: 'x' } });
    expect(request).not.toHaveBeenCalled();
  });
});
