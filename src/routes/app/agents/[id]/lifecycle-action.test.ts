/**
 * portal#2194 (hadron-server#4242): the Agent page lets a manager choose how long
 * the agent's workers run. The action sends `updateAgent(ref, lifecycle)` and
 * nothing else, refuses a value that is not one of the two before any request,
 * and shows the server's refusal as text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_AGENT_LIFECYCLE_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ updateAgent: { id: 'agent-1', lifecycle: 'SHORT_LIVED' } });
});

async function run(lifecycle?: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  if (lifecycle !== undefined) fd.set('lifecycle', lifecycle);
  return actions.updateLifecycle({ request: { formData: async () => fd }, params: { id: 'agent-1' }, locals: { token: 'tok' } } as never);
}
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
const sent = () => mockRequest.mock.calls.filter(([q]) => q === UPDATE_AGENT_LIFECYCLE_MUTATION);

describe('Agent lifecycle action (portal#2194)', () => {
  it.each(['LONG_LIVED', 'SHORT_LIVED'])('round-trips %s: sends exactly ref and lifecycle', async (value) => {
    const result = await run(value);
    expect(sent()).toHaveLength(1);
    expect(sent()[0][1]).toEqual({ ref: 'agent-1', lifecycle: value });
    expect(result).toEqual({ lifecycleSaved: value });
  });

  it('refuses a value that is not a lifecycle before any request', async () => {
    for (const bad of [undefined, '', 'long_lived', 'FOREVER']) {
      const result = (await run(bad)) as { status: number; data: { lifecycleError: string } };
      expect(result.status).toBe(400);
      expect(result.data.lifecycleError).toBeTruthy();
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('shows the server refusal as text, with its status', async () => {
    mockRequest.mockRejectedValue(gqlError('FORBIDDEN', 'Forbidden'));
    const result = (await run('SHORT_LIVED')) as { status: number; data: { lifecycleError: string } };
    expect(result.status).toBe(403);
    expect(result.data.lifecycleError).toMatch(/owner or an organization admin/);
  });

  it('a GraphQL error response did not commit: released, and says Try again (not a permission claim)', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'boom'));
    const result = (await run('SHORT_LIVED')) as { status: number; data: { lifecycleError: string; uncertain?: boolean } };
    expect(result.status).toBe(500);
    expect(result.data.uncertain).toBeUndefined();
    expect(result.data.lifecycleError).toMatch(/try again/i);
    expect(result.data.lifecycleError).not.toMatch(/owner|admin/i);
  });

  it('a transport failure may have committed: marked uncertain, never "Not saved"', async () => {
    mockRequest.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = (await run('SHORT_LIVED')) as { status: number; data: { lifecycleError: string; uncertain?: boolean } };
    expect(result.status).toBe(502);
    expect(result.data.uncertain).toBe(true);
    expect(result.data.lifecycleError).toMatch(/couldn.t confirm/i);
    expect(result.data.lifecycleError).not.toMatch(/not saved|owner|admin/i);
  });
});
