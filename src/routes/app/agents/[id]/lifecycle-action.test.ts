/**
 * portal#2196: the lifecycle control classifies a failed write. Only a recognised refusal came
 * before any commit; an unrelated `*_NOT_FOUND` may have come after one and stays uncertain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
});

async function run(lifecycle = 'LONG_LIVED') {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('lifecycle', lifecycle);
  return actions.updateLifecycle!({ request: { formData: async () => fd }, params: { id: 'agent-1' }, locals: { token: 'tok' } } as never) as Promise<{ status: number; data: { lifecycleError: string; uncertain?: boolean } }>;
}
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });

describe('Agent lifecycle action (portal#2196)', () => {
  it.each(['INTERNAL_SERVER_ERROR', 'SOMETHING_ELSE', 'FOO_NOT_FOUND'])('GraphQL code %s can come after a commit: outcome unknown, never "Not saved"', async (code) => {
    mockRequest.mockRejectedValueOnce(gqlError(code, 'secret internals'));
    const result = await run();
    expect(result.status).toBe(502);
    expect(result.data.uncertain).toBe(true);
    expect(result.data.lifecycleError).not.toMatch(/not saved|secret internals/i);
  });

  it('AGENT_NOT_FOUND did not commit: released as 404, not uncertain', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('AGENT_NOT_FOUND', 'Refused.'));
    const result = await run();
    expect(result.status).toBe(404);
    expect(result.data.uncertain).toBeUndefined();
  });

  it('FORBIDDEN did not commit: released as 403, not uncertain', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Refused.'));
    const result = await run();
    expect(result.status).toBe(403);
    expect(result.data.uncertain).toBeUndefined();
  });
});
