import { expect, it, vi } from 'vitest';
import { load } from './+page.server';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
it('returns the Dashboard shell data while chart requests remain pending', async () => {
  request.mockImplementation(() => new Promise(() => {}));
  let returned = false;
  const navigation = Promise.resolve(load({ locals: { token: 'synthetic' } } as never)).then(result => { returned = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(returned).toBe(true);
  const data = await navigation as { dashboard: unknown; widgetData: unknown };
  expect(data.dashboard).toBeInstanceOf(Promise);
  expect(data.widgetData).toBeInstanceOf(Promise);
});
