/**
 * portal#1405 (hadron-server#2171, R211, cor:dmo:050:04): the Agent page lets a
 * manager choose which roles people can have in Apps using this Agent. The
 * action sends `updateAgent(ref, memberRoles)` and nothing else, never an empty
 * list, and shows the server's refusal at the `roles` field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_AGENT_MEMBER_ROLES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ updateAgent: { id: 'agent-1', installationPolicy: { memberRoles: [] } } });
});

async function run(roles: string[]) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('_kind', 'updateMemberRoles');
  for (const r of roles) fd.append('roles', r);
  return actions.updateMemberRoles({
    request: { formData: async () => fd },
    params: { id: 'agent-1' },
    locals: { token: 'tok' },
  } as never);
}

const formOf = (result: unknown) => (result as { data?: { form?: { valid?: boolean; message?: unknown; errors?: Record<string, string[]> } }; form?: unknown } | undefined)?.data?.form;
const calls = () => mockRequest.mock.calls.filter(([query]) => query === UPDATE_AGENT_MEMBER_ROLES_MUTATION);

function gqlError(code: string, message: string) {
  return { response: { errors: [{ message, extensions: { code } }] } };
}

describe('Agent member-roles action (portal#1405)', () => {
  it('sends exactly the new list, and only memberRoles, to updateAgent', async () => {
    const result = await run(['owner', 'member', 'reviewer']);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][1]).toEqual({ ref: 'agent-1', memberRoles: ['owner', 'member', 'reviewer'] });
    expect(formOf(result)?.message).toMatchObject({ type: 'success' });
  });

  it('the mutation document names memberRoles and no other updateAgent argument', () => {
    expect(UPDATE_AGENT_MEMBER_ROLES_MUTATION).toMatch(/updateAgent\(ref: \$ref, memberRoles: \$memberRoles\)/);
  });

  it('never sends an empty list: refused before any request', async () => {
    const result = await run([]);
    expect(calls()).toHaveLength(0);
    expect(formOf(result)?.valid).toBe(false);
    expect(formOf(result)?.errors?.roles?.[0]).toBe('An Agent needs at least one role.');
  });

  it('a malformed role from the server shows its message at the roles field', async () => {
    mockRequest.mockRejectedValue(gqlError('BAD_USER_INPUT', 'Role "Bad Role" must be lowercase letters, digits and hyphens.'));
    const result = await run(['Bad Role']);
    expect(formOf(result)?.errors?.roles?.[0]).toBe('Role "Bad Role" must be lowercase letters, digits and hyphens.');
  });

  it('a refusal for lack of access is not a field error', async () => {
    mockRequest.mockRejectedValue(gqlError('FORBIDDEN', 'Forbidden'));
    const result = await run(['owner']);
    expect(formOf(result)?.errors?.roles).toBeUndefined();
    expect(formOf(result)?.message).toMatchObject({ type: 'error' });
  });
});
