import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { actions } from './+page.server';

const invoke = async (confirmation: unknown = 'verified-no-external-attribution', workerRef = 'worker-one', edit?: (data: FormData) => void) => {
  const data = new FormData(); data.set('_kind', 'deleteWorker'); data.set('workerRef', workerRef);
  if (confirmation !== undefined && confirmation !== null) data.set('confirmation', String(confirmation));
  edit?.(data);
  return (actions as any).deleteWorker({ request: new Request('http://localhost/app/apps/app-one?/deleteWorker', { method: 'POST', body: data }), locals: { token: 'synthetic' }, params: { appId: 'app-one' } });
};
beforeEach(() => { request.mockReset(); });
describe('verified-unused worker action (#1023)', () => {
  it.each([undefined, null, false, 'false', 'true', '', 'on', 'verified', '1'])('does not manufacture consent from %s', async value => {
    const result = await invoke(value === undefined ? null : value);
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
    expect(result.data.deleteWorkerResult.ok).toBe(false);
  });
  it.each(['confirmation', 'workerRef', '_kind'])('rejects repeated %s fields rather than selecting one', async field => {
    const result = await invoke('verified-no-external-attribution', 'worker-one', data => data.append(field, String(data.get(field))));
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a file-valued confirmation', async () => {
    const result = await invoke('verified-no-external-attribution', 'worker-one', data => data.set('confirmation', new Blob(['verified-no-external-attribution']), 'consent.txt'));
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('does not claim success when the server does not confirm deletion', async () => {
    request.mockResolvedValue({ deleteWorker: false });
    const result = await invoke();
    expect(result.data.deleteWorkerResult.ok).toBe(false);
  });
  it('does not expose transport diagnostics or request variables', async () => {
    request.mockRejectedValue(new Error('transport failure with private variables'));
    const result = await invoke();
    expect(result.status).toBe(500);
    expect(JSON.stringify(result)).not.toContain('private variables');
    expect(result.data.deleteWorkerResult.ok).toBe(false);
  });
  it('keeps an unknown server failure a 500 without exposing internal diagnostics', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'private internal diagnostic', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] } });
    const result = await invoke();
    expect(result.status).toBe(500);
    expect(JSON.stringify(result)).not.toContain('private internal diagnostic');
  });
  it('forwards only the exact selected worker and explicit literal true', async () => {
    request.mockResolvedValue({ deleteWorker: true });
    const result = await invoke();
    expect(request).toHaveBeenCalledWith(expect.stringContaining('mutation DeleteWorker'), { workerRef: 'worker-one', confirmNoExternalAttribution: true });
    expect(result.deleteWorkerResult).toMatchObject({ ok: true, workerRef: 'worker-one' });
  });
  it.each(['WORKER_IN_USE', 'WORKER_EXTERNAL_ATTRIBUTION_UNCONFIRMED', 'FORBIDDEN', 'WORKER_NOT_FOUND'])('keeps %s a refusal without claiming deletion', async code => {
    request.mockRejectedValue({ response: { errors: [{ message: '<b>Refused</b> {{> no}}', extensions: { code } }] } });
    const result = await invoke('verified-no-external-attribution', 'foreign-worker');
    expect(request.mock.calls[0][1].workerRef).toBe('foreign-worker');
    expect(result.data.deleteWorkerResult).toMatchObject({ ok: false, workerRef: 'foreign-worker', code, message: '<b>Refused</b> {{> no}}' });
  });
});
