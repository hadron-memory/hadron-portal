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

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { message?: unknown; valid?: boolean } };
    form?: { message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

describe('agent update action (#488)', () => {
  it('OMITS systemMemoryId when the field is empty — never sends null', async () => {
    const result = await runUpdate({ name: 'Agent', urnSlug: 'agent', visibility: 'PUBLIC', systemMemoryId: '' });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Changes saved.' });
    expect(superFormFrom(result)?.valid).toBe(true);
    const vars = updateAgentVariables();
    expect(vars.visibility).toBe('PUBLIC');
    expect(vars.systemMemoryId).toBeUndefined();
    // Explicit-null would resurrect the bug even if undefined round-trips.
    expect('systemMemoryId' in vars && vars.systemMemoryId === null).toBe(false);
  });

  it('passes a real first-attach systemMemoryId through', async () => {
    await runUpdate({ name: 'Agent', urnSlug: 'agent', systemMemoryId: 'mem-9' });
    expect(updateAgentVariables().systemMemoryId).toBe('mem-9');
  });

  it('passes visibility through verbatim (uppercase enum)', async () => {
    await runUpdate({ name: 'Agent', urnSlug: 'agent', visibility: 'ORGANIZATION' });
    expect(updateAgentVariables().visibility).toBe('ORGANIZATION');
  });
});

/**
 * #712 — the persona fields are the MIRROR IMAGE of systemMemoryId above:
 * blank is a real value here (the server normalizes blank-after-trim to null,
 * which is how the user clears one), so '' must be SENT, not omitted.
 */
describe('agent update action — persona fields (#712)', () => {
  it('sends persona fields through', async () => {
    await runUpdate({
      name: 'Iris', urnSlug: 'iris',
      personaName: 'Iris', personaRole: 'backend-engineer', personaPrompt: 'You are Iris.',
    });
    expect(updateAgentVariables()).toMatchObject({
      personaName: 'Iris',
      personaRole: 'backend-engineer',
      personaPrompt: 'You are Iris.',
    });
  });

  it('sends EMPTY persona fields as "" so the server clears them', async () => {
    await runUpdate({ name: 'Agent', urnSlug: 'agent', personaName: '', personaRole: '', personaPrompt: '' });
    const vars = updateAgentVariables();
    expect(vars.personaName).toBe('');
    expect(vars.personaRole).toBe('');
    expect(vars.personaPrompt).toBe('');
  });
});
