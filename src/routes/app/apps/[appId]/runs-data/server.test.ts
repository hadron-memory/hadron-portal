import { beforeEach, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const mocks = vi.hoisted(() => {
  const client = { request: vi.fn() };
  return { client, gqlClient: vi.fn(() => client), loadAppRunsPage: vi.fn() };
});
vi.mock('$lib/server/api', () => ({ gqlClient: mocks.gqlClient }));
vi.mock('$lib/server/app-runs-page', () => ({ loadAppRunsPage: mocks.loadAppRunsPage }));

beforeEach(() => { mocks.gqlClient.mockClear(); mocks.loadAppRunsPage.mockReset(); });
const section = { page: 1, statuses: ['FAILED'], sort: 'createdAt', dir: 'desc', runs: [], total: 0, failed: false, explicitState: true };
const event = (token?: string) => ({ params: { appId: 'hrn:app:example.test:qa' }, locals: { token }, url: new URL('https://example.test/app/apps/qa/runs-data?tab=runs&page=3&status=FAILED') });

it.each(['person-fixture-token', 'impersonation-fixture-token'])('uses only the supplied caller token (%s) and forbids caching', async token => {
  mocks.loadAppRunsPage.mockResolvedValue(section);
  const { GET } = await import('./+server');
  const request = event(token);
  const response = await GET(request as never);
  expect(mocks.gqlClient).toHaveBeenCalledExactlyOnceWith(token);
  expect(mocks.loadAppRunsPage).toHaveBeenCalledExactlyOnceWith(mocks.client, request.params.appId, request.url.searchParams);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual(section);
});

it('keeps the failed-read flag and no-store header instead of claiming empty success', async () => {
  mocks.loadAppRunsPage.mockResolvedValue({ ...section, failed: true });
  const { GET } = await import('./+server');
  const response = await GET(event('person-fixture-token') as never);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ failed: true, total: 0 });
});

it('propagates the helper concealment refusal, including with no caller token', async () => {
  mocks.loadAppRunsPage.mockImplementation(async () => { error(404, 'App not found'); });
  const { GET } = await import('./+server');
  await expect(GET(event() as never)).rejects.toMatchObject({ status: 404, body: { message: 'App not found' } });
  expect(mocks.gqlClient).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(mocks.loadAppRunsPage).toHaveBeenCalledOnce();
});
