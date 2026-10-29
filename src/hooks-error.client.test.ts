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
