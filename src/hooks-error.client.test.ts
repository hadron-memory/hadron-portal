import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$lib/server/node-advice', () => ({ nodeAdviceHandle: vi.fn() }));
vi.mock('$lib/server/session-action-guard', () => ({ sessionActionGuard: vi.fn() }));
vi.mock('$lib/server/csp', () => ({ appendConnectSrc: vi.fn(), resolveAssetStorageOrigin: () => null }));

import { handleError } from './hooks.server';

afterEach(() => { vi.restoreAllMocks(); });

it('logs an unexpected portal exception while returning only safe reader copy', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = new TypeError('private portal render failure');
  const result = await handleError({ error, status: 500, message: 'Internal Error', event: {} as never });
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]).toContainEqual(expect.objectContaining({ error, status: 500 }));
  expect(result).toEqual({ message: 'Something went wrong on our side.' });
});

it.each([[400, 'Bad Request'], [403, 'Forbidden'], [404, 'Not Found']])(
  'preserves SvelteKit %s framework copy', async (status, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleError({ error: new Error('not reader copy'), status: Number(status), message: String(message), event: {} as never });
    expect(result).toEqual({ message });
  },
);

it('preserves a validated GraphQL request id without returning its diagnostics', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const requestId = 'a4451409-72f6-4f08-b90b-f8db328e8c58';
  const error = { response: { errors: [{ message: 'SELECT private FROM /srv/internal.ts', extensions: { code: 'INTERNAL_SERVER_ERROR', requestId } }] } };
  const result = await handleError({ error, status: 500, message: 'Internal Error', event: {} as never });
  expect(result).toEqual({ message: 'Something went wrong on our side.', requestId });
});
