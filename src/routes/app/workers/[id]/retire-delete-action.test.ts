import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { actions } from './+page.server';

const IN_USE_SENTENCE = 'This worker has history — retire it instead.';
const STAFFING_REFUSAL =
  'You don’t have permission to staff this App. Casting and retiring need contributor access to the organization, or a non-reader role in the App.';

// The page's rule (mirrored from every other action here): the worker acted on
// is the ROUTE's (params.id), never a posted ref. The delete dialog posts the
// worker id it rendered with, which for this page is the same worker — a
// MISMATCHED post is what these tests force.
const invokeDelete = async (
  confirmation: unknown = 'verified-no-external-attribution',
  workerRef = 'worker-one',
  edit?: (data: FormData) => void,
) => {
  const data = new FormData();
  data.set('_kind', 'deleteWorker');
  data.set('workerRef', workerRef);
  if (confirmation !== undefined && confirmation !== null) data.set('confirmation', String(confirmation));
  edit?.(data);
  return (actions as any).deleteWorker({
    request: new Request('http://localhost/app/workers/worker-one?/deleteWorker', { method: 'POST', body: data }),
    locals: { token: 'synthetic' },
    params: { id: 'worker-one' },
  });
};
const invokeRetire = async (kind: unknown = 'retireWorker', edit?: (data: FormData) => void) => {
  const data = new FormData();
  if (kind !== undefined && kind !== null) data.set('_kind', String(kind));
  edit?.(data);
  return (actions as any).retireWorker({
    request: new Request('http://localhost/app/workers/worker-one?/retireWorker', { method: 'POST', body: data }),
    locals: { token: 'synthetic' },
    params: { id: 'worker-one' },
  });
};

beforeEach(() => { request.mockReset(); });

describe('worker page retireWorker action (portal#2205)', () => {
  it('retires the route’s worker after the explicit _kind guard', async () => {
    request.mockResolvedValue({ retireWorker: { id: 'worker-one' } });
    const result = await invokeRetire();
    expect(request).toHaveBeenCalledWith(expect.stringContaining('mutation RetireWorker'), { workerRef: 'worker-one' });
    expect(result.retireResult).toMatchObject({ ok: true, key: 'worker-one' });
  });
  it.each([undefined, null, '', 'deleteWorker', 'retire', 0])('refuses a _kind of %s without calling the server', async kind => {
    // undefined would trip invokeRetire’s default parameter, so the absent
    // case is sent as null (no _kind field at all).
    const result = await invokeRetire(kind === undefined ? null : kind);
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
    expect(result.data.retireResult).toMatchObject({ ok: false, key: 'worker-one' });
  });
  it('rejects repeated _kind fields rather than selecting one', async () => {
    const result = await invokeRetire('retireWorker', data => data.append('_kind', 'retireWorker'));
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('translates FORBIDDEN into the roster’s staffing refusal', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } });
    const result = await invokeRetire();
    expect(result.status).toBe(403);
    expect(result.data.retireResult).toMatchObject({ ok: false, key: 'worker-one', message: STAFFING_REFUSAL });
  });
  it('keeps WORKER_NOT_FOUND a 404 carrying the server sentence', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'Worker not found.', extensions: { code: 'WORKER_NOT_FOUND' } }] } });
    const result = await invokeRetire();
    expect(result.status).toBe(404);
    expect(result.data.retireResult).toMatchObject({ ok: false, key: 'worker-one', message: 'Worker not found.' });
  });
  it.each([
    ['a lost response', () => new Error('transport failure with private variables')],
    ['an unrecognized GraphQL error', () => ({ response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } })],
  ])('answers %s as an UNKNOWN OUTCOME (502, uncertain), never a definite failure', async (_label, make) => {
    request.mockRejectedValue(make());
    const result = await invokeRetire();
    expect(result.status).toBe(502);
    expect(result.data.retireResult).toMatchObject({ ok: false, key: 'worker-one', uncertain: true });
    expect(result.data.retireResult.message).toContain('Couldn’t confirm the retirement');
    expect(JSON.stringify(result)).not.toContain('private variables');
  });
  it('emits only the closed transport record (ruling 0247), never the exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      request.mockRejectedValue(new Error('transport failure with private variables'));
      await invokeRetire();
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0][0] as string;
      const record = JSON.parse(line);
      expect(record).toEqual({ event: 'app_action_transport_failure', action: 'retire', classification: 'transport' });
      expect(line).not.toContain('private variables');
      // A definite refusal emits nothing at all.
      warn.mockClear();
      request.mockRejectedValue({ response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } });
      await invokeRetire();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('worker page deleteWorker action (portal#2205)', () => {
  it.each([undefined, null, false, 'false', 'true', '', 'on', 'verified', '1'])('does not manufacture consent from %s', async value => {
    const result = await invokeDelete(value === undefined ? null : value);
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
    expect(result.data.deleteWorkerResult.ok).toBe(false);
  });
  it.each(['confirmation', 'workerRef', '_kind'])('rejects repeated %s fields rather than selecting one', async field => {
    const result = await invokeDelete('verified-no-external-attribution', 'worker-one', data => data.append(field, String(data.get(field))));
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('deletes the route’s worker, never a posted ref, and redirects to its App staff roster', async () => {
    request.mockResolvedValueOnce({ worker: { id: 'worker-one', app: { id: 'app-one' } } });
    request.mockResolvedValueOnce({ deleteWorker: true });
    const attempt = invokeDelete('verified-no-external-attribution', 'foreign-worker');
    await expect(attempt).rejects.toMatchObject({ status: 303, location: '/app/apps/app-one?tab=staff' });
    expect(request).toHaveBeenNthCalledWith(1, expect.stringContaining('query WorkerApp'), { ref: 'worker-one' });
    expect(request).toHaveBeenNthCalledWith(2, expect.stringContaining('mutation DeleteWorker'), { workerRef: 'worker-one', confirmNoExternalAttribution: true });
  });
  it('falls back to the org’s Apps list when the App row is masked but its org is known (#742)', async () => {
    request.mockResolvedValueOnce({ worker: { id: 'worker-one', app: { id: null, organizationId: 'org-one' } } });
    request.mockResolvedValueOnce({ deleteWorker: true });
    // /app/apps is the org-less "My apps" list and cannot contain an
    // org-owned App — the org list is the list the App is actually on.
    await expect(invokeDelete()).rejects.toMatchObject({ status: 303, location: '/app/orgs/org-one/apps' });
  });
  it('falls back to the org-less apps list when nothing about the App is known', async () => {
    request.mockResolvedValueOnce({ worker: { id: 'worker-one', app: null } });
    request.mockResolvedValueOnce({ deleteWorker: true });
    await expect(invokeDelete()).rejects.toMatchObject({ status: 303, location: '/app/apps' });
  });
  // portal#2223 F5 — the redirect target is best-effort: a failed WorkerApp
  // lookup (a throw, or a masked null worker) never fails or blocks the delete.
  it.each([
    ['the lookup throws', (r: typeof request) => r.mockRejectedValueOnce(new Error('lookup down'))],
    ['the lookup answers a null worker', (r: typeof request) => r.mockResolvedValueOnce({ worker: null })],
  ])('still deletes and falls back to /app/apps when %s', async (_name, lookup) => {
    lookup(request);
    request.mockResolvedValueOnce({ deleteWorker: true });
    await expect(invokeDelete()).rejects.toMatchObject({ status: 303, location: '/app/apps' });
    expect(request).toHaveBeenNthCalledWith(2, expect.stringContaining('mutation DeleteWorker'), { workerRef: 'worker-one', confirmNoExternalAttribution: true });
  });
  // portal#2223 F3 — only a real Kit redirect is rethrown. An unrelated throw
  // that merely carries a `location` property is a failed delete, not a redirect.
  it('does not rethrow a non-redirect error that happens to carry a location', async () => {
    request.mockResolvedValueOnce({ worker: { id: 'worker-one', app: { id: 'app-one' } } });
    request.mockRejectedValueOnce(Object.assign(new Error('boom'), { location: '/somewhere' }));
    const result = await invokeDelete();
    expect(result.status).toBe(502);
    expect(result.data.deleteWorkerResult).toMatchObject({ ok: false, uncertain: true });
  });
  it('does not claim success when the server does not confirm deletion', async () => {
    request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
    request.mockResolvedValueOnce({ deleteWorker: false });
    const result = await invokeDelete();
    expect(result.status).toBe(500);
    expect(result.data.deleteWorkerResult.ok).toBe(false);
  });
  it('answers WORKER_IN_USE with the fixed retire-instead sentence, not the server text', async () => {
    request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'census details are private', extensions: { code: 'WORKER_IN_USE' } }] } });
    const result = await invokeDelete();
    expect(result.status).toBe(400);
    expect(result.data.deleteWorkerResult).toMatchObject({ ok: false, workerRef: 'worker-one', code: 'WORKER_IN_USE', message: IN_USE_SENTENCE });
    expect(JSON.stringify(result)).not.toContain('census');
  });
  it.each(['WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED', 'WORKER_NOT_FOUND'])('keeps %s a refusal carrying only the server sentence', async code => {
    request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'Server refusal sentence.', extensions: { code } }] } });
    const result = await invokeDelete();
    expect(result.status).toBe(code === 'WORKER_NOT_FOUND' ? 404 : 400);
    expect(result.data.deleteWorkerResult).toMatchObject({ ok: false, workerRef: 'worker-one', code, message: 'Server refusal sentence.' });
  });
  it('translates FORBIDDEN into the staffing refusal, echoing the posted ref the dialog guards on', async () => {
    request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } });
    const result = await invokeDelete('verified-no-external-attribution', 'worker-one');
    expect(result.status).toBe(403);
    expect(result.data.deleteWorkerResult.message).toBe(STAFFING_REFUSAL);
  });
  it('does not expose transport diagnostics or request variables', async () => {
    request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
    request.mockRejectedValueOnce(new Error('transport failure with private variables'));
    const result = await invokeDelete();
    // portal#2227 — a lost response is an UNKNOWN OUTCOME (retire's
    // convention), never a definite failure a retry would contradict.
    expect(result.status).toBe(502);
    expect(result.data.deleteWorkerResult).toMatchObject({ ok: false, workerRef: 'worker-one', uncertain: true });
    expect(result.data.deleteWorkerResult.message).toBe('The delete may have succeeded. Reload to see the current state.');
    expect(JSON.stringify(result)).not.toContain('private variables');
  });
  it('answers an unrecognized GraphQL error as an unknown outcome too, without its diagnostics', async () => {
    request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'private internal diagnostic', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    const result = await invokeDelete();
    expect(result.status).toBe(502);
    expect(result.data.deleteWorkerResult).toMatchObject({ ok: false, uncertain: true });
    expect(JSON.stringify(result)).not.toContain('private internal diagnostic');
  });
  it('emits only the closed transport record for a lost delete (ruling 0247), never the exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
      request.mockRejectedValueOnce(new Error('transport failure with private variables'));
      await invokeDelete();
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0][0] as string;
      const record = JSON.parse(line);
      expect(record).toEqual({ event: 'app_action_transport_failure', action: 'delete', classification: 'transport' });
      expect(line).not.toContain('private variables');
      // A definite refusal emits nothing at all, and the best-effort roster
      // lookup swallow (its own catch) emits nothing either.
      warn.mockClear();
      request.mockResolvedValueOnce({ worker: { app: { id: 'app-one' } } });
      request.mockRejectedValueOnce({ response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } });
      await invokeDelete();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
