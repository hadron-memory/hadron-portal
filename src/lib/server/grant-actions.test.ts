import { expect, it, vi } from 'vitest';
import { readGrantActions } from './grant-actions';
const action = (name: string) => ({ name, parameters: [{ name: 'node', type: 'node-ref', refusesWildcard: true }] });
it('reads every served page without persisting a catalogue between loads', async () => {
  const request = vi.fn().mockResolvedValueOnce({ grantActions: { items: [action('a')], total: 2 } })
    .mockResolvedValueOnce({ grantActions: { items: [action('b')], total: 2 } })
    .mockResolvedValueOnce({ grantActions: { items: [action('new')], total: 1 } });
  expect((await readGrantActions({ request } as never, 'app')).map((a) => a.name)).toEqual(['a', 'b']);
  expect(request.mock.calls.map(([, v]) => v.offset)).toEqual([0, 1]);
  expect((await readGrantActions({ request } as never, 'app')).map((a) => a.name)).toEqual(['new']);
});
it('does not turn an outage or incomplete catalogue into an old action fallback', async () => {
  const request = vi.fn().mockRejectedValueOnce(Error('offline'))
    .mockResolvedValueOnce({ grantActions: { items: [], total: 5 } });
  await expect(readGrantActions({ request } as never, 'app')).rejects.toThrow('offline');
  await expect(readGrantActions({ request } as never, 'app')).rejects.toThrow('Incomplete');
});

it.each(['FORBIDDEN', 'UNAUTHENTICATED', 'APP_NOT_FOUND', 'NOT_FOUND'])('keeps a %s refusal indistinguishable from empty', async (code) => {
  const request = vi.fn().mockRejectedValue({ response: { errors: [{ extensions: { code } }] } });
  expect(await readGrantActions({ request } as never, 'app')).toEqual([]);
});
it('does not swallow BAD_USER_INPUT as an empty catalogue', async () => {
  const fault = { response: { errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] } };
  const request = vi.fn().mockRejectedValue(fault);
  await expect(readGrantActions({ request } as never, 'app')).rejects.toBe(fault);
});
