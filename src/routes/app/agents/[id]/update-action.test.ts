/**
 * Regression for #488 — "saving visibility fails".
 *
 * The update action sent systemMemoryId: null whenever the form's select
 * was empty, and updateAgent THROWS on unset/change once a system memory
 * is attached — so the whole save (visibility included) failed whenever
 * the select degraded to "— None —" (the current memory missing from the
 * membership-gated options list). '' must OMIT the variable, never null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_AGENT_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
});

async function runUpdate(fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const event = {
    request: { formData: async () => fd },
    params: { id: 'agent-1' },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)['update']>[0];
  return actions.update(event);
}

function updateAgentVariables() {
  const call = mockRequest.mock.calls.find(([query]) => query === UPDATE_AGENT_MUTATION);
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
}

describe('agent update action (#488)', () => {
  it('OMITS systemMemoryId when the field is empty — never sends null', async () => {
    const result = await runUpdate({ name: 'Agent', visibility: 'PUBLIC', systemMemoryId: '' });
    expect(result).toEqual({ success: true });
    const vars = updateAgentVariables();
    expect(vars.visibility).toBe('PUBLIC');
    expect(vars.systemMemoryId).toBeUndefined();
    // Explicit-null would resurrect the bug even if undefined round-trips.
    expect('systemMemoryId' in vars && vars.systemMemoryId === null).toBe(false);
  });

  it('passes a real first-attach systemMemoryId through', async () => {
    await runUpdate({ name: 'Agent', systemMemoryId: 'mem-9' });
    expect(updateAgentVariables().systemMemoryId).toBe('mem-9');
  });

  it('passes visibility through verbatim (uppercase enum)', async () => {
    await runUpdate({ name: 'Agent', visibility: 'ORGANIZATION' });
    expect(updateAgentVariables().visibility).toBe('ORGANIZATION');
  });
});
