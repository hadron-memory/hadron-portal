/**
 * portal#2464 (hadron-server#4777): the wake-roles action sends exactly appRef and the whole list, and routes
 * each server refusal to its own words; the read keeps ok / hidden / failed apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_SATURATION_ALARM_WAKE_ROLES_MUTATION } from '$lib/server/queries';
import { loadSaturationAlarmWakeRoles } from '$lib/server/saturation-wake-roles';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ setSaturationAlarmWakeRoles: { appId: 'app-1', roles: ['a', 'b'] } });
});

async function run(roles: string[]) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const r of roles) fd.append('roles', r);
  return actions.setSaturationAlarmWakeRoles({ request: { formData: async () => fd }, params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
}
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
type Fail = { status: number; data: { wakeRolesError: string; uncertain?: boolean } };

describe('setSaturationAlarmWakeRoles action', () => {
  it('sends exactly appRef and the whole list as given, and returns what the server stored', async () => {
    const result = await run(['b', 'A ']);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0]).toEqual([SET_SATURATION_ALARM_WAKE_ROLES_MUTATION, { appRef: 'app-1', roles: ['b', 'A '] }]);
    expect(result).toEqual({ wakeRolesSaved: ['a', 'b'] });
  });

  it('the empty list is sent, not skipped (it clears)', async () => {
    await run([]);
    expect(mockRequest.mock.calls[0][1]).toEqual({ appRef: 'app-1', roles: [] });
  });

  it('BAD_USER_INPUT shows the server sentence (the cap comes from it)', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('BAD_USER_INPUT', 'At most 32 names.'));
    const r = (await run(['x'])) as unknown as Fail;
    expect(r.status).toBe(400);
    expect(r.data.wakeRolesError).toBe('At most 32 names.');
  });

  it('APP_NOT_FOUND never reads as a deleted App', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('APP_NOT_FOUND', 'App not found'));
    const r = (await run(['x'])) as unknown as Fail;
    expect(r.status).toBe(404);
    expect(r.data.wakeRolesError).not.toMatch(/not found|deleted|gone|exist/i);
  });

  it.each([
    ['APP_MANAGER_REQUIRED', 403, /manages this App/],
    ['APP_UNINSTALLED', 409, /uninstalled/],
    ['SESSION_NOT_BOUND', 409, /Sign in/],
  ])('%s gets its own fixed words', async (code, status, text) => {
    mockRequest.mockRejectedValueOnce(gqlError(code, 'server internals'));
    const r = (await run(['x'])) as unknown as Fail;
    expect(r.status).toBe(status);
    expect(r.data.wakeRolesError).toMatch(text);
    expect(r.data.wakeRolesError).not.toContain('server internals');
  });

  it('a transport failure may have committed: uncertain, never "Not saved"', async () => {
    mockRequest.mockRejectedValueOnce(new TypeError('fetch failed'));
    const r = (await run(['x'])) as unknown as Fail;
    expect(r.status).toBe(502);
    expect(r.data.uncertain).toBe(true);
    expect(r.data.wakeRolesError).not.toMatch(/not saved/i);
  });
});

describe('loadSaturationAlarmWakeRoles', () => {
  const client = { request: mockRequest } as never;
  it('ok carries the list, empty included', async () => {
    mockRequest.mockResolvedValueOnce({ saturationAlarmWakeRoles: { appId: 'a', roles: [] } });
    expect(await loadSaturationAlarmWakeRoles(client, 'app-1')).toEqual({ kind: 'ok', roles: [] });
  });
  it('APP_NOT_FOUND is hidden', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('APP_NOT_FOUND', 'x'));
    expect(await loadSaturationAlarmWakeRoles(client, 'app-1')).toEqual({ kind: 'hidden' });
  });
  it('anything else is failed, not hidden and not empty', async () => {
    mockRequest.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await loadSaturationAlarmWakeRoles(client, 'app-1')).toEqual({ kind: 'failed' });
    mockRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'x'));
    expect(await loadSaturationAlarmWakeRoles(client, 'app-1')).toEqual({ kind: 'failed' });
  });
});
