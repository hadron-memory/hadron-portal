/**
 * portal#1405 (hadron-server#2171, R211, hrn:node:hadronmemory.com:specs:cor:dmo:050:04): the Agent page lets a
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

async function run(roles: string[], formId?: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('_kind', 'updateMemberRoles');
  if (formId !== undefined) fd.set('__superform_id', formId);
  for (const r of roles) fd.append('roles', r);
  return actions.updateMemberRoles({
    request: { formData: async () => fd },
    params: { id: 'agent-1' },
    locals: { token: 'tok' },
  } as never);
}

type ActionForm = { id?: string; valid?: boolean; message?: unknown; errors?: { roles?: string[] | { _errors?: string[] } } };
// fail() wraps the form in `data`; message() returns it as `form`. The producer has
// two shapes for an array field: schema validation nests under `_errors`, while
// setError() on the field is a plain list.
const formOf = (result: unknown): ActionForm | undefined => {
  const r = result as { data?: { form?: ActionForm }; form?: ActionForm } | undefined;
  return r?.data?.form ?? r?.form;
};
const rolesError = (result: unknown) => {
  const roles = formOf(result)?.errors?.roles;
  return Array.isArray(roles) ? roles[0] : roles?._errors?.[0];
};
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
    expect(rolesError(result)).toBe('An Agent needs at least one role.');
  });

  it('a malformed role from the server shows its message at the roles field', async () => {
    mockRequest.mockRejectedValue(gqlError('BAD_USER_INPUT', 'Invalid member role "Bad Role": use 1-32 characters, a lowercase letter first, then lowercase letters, digits, "_" or "-".'));
    const result = await run(['Bad Role']);
    expect(rolesError(result)).toBe('Invalid member role "Bad Role": use 1-32 characters, a lowercase letter first, then lowercase letters, digits, "_" or "-".');
  });

  it('a refusal for lack of access is not a field error', async () => {
    mockRequest.mockRejectedValue(gqlError('FORBIDDEN', 'Forbidden'));
    const result = await run(['owner']);
    expect(rolesError(result)).toBeUndefined();
    expect(formOf(result)?.message).toMatchObject({ type: 'error' });
  });

  it('an internal fault keeps the shared envelope and its request id, never the permission copy', async () => {
    const id = 'a4451409-72f6-4f08-b90b-f8db328e8c58';
    mockRequest.mockRejectedValue({ response: { errors: [{ message: 'SELECT private FROM /srv/users.ts', extensions: { code: 'INTERNAL_SERVER_ERROR', requestId: id } }] } });
    const text = (formOf(await run(['owner'])) as { message?: { text?: string } }).message?.text ?? '';
    expect(text).toContain(id);
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('owner or an organization admin');
  });

  it('an unknown fault says to try again, not that access is missing', async () => {
    mockRequest.mockRejectedValue(new Error('socket hang up'));
    const text = (formOf(await run(['owner'])) as { message?: { text?: string } }).message?.text ?? '';
    expect(text).toBe('The roles were not saved. Try again.');
  });

  it('answers under the Agent-scoped id the form posted (portal#2068), so a late result finds only that Agent\u2019s editor', async () => {
    expect(formOf(await run(['owner'], 'updateMemberRoles:agent-a'))).toMatchObject({ id: 'updateMemberRoles:agent-a' });
    expect(formOf(await run([], 'updateMemberRoles:agent-a'))).toMatchObject({ id: 'updateMemberRoles:agent-a' });
  });

  it('answers a native POST under the scoped id its markup names, refusals included (portal#2068, LOCAL F1 on #2071)', async () => {
    const id = 'updateMemberRoles:agent-a';
    expect(formOf(await run([], id))).toMatchObject({ id, valid: false });
    expect(formOf(await run(['owner'], id))).toMatchObject({ id });
  });

  it('the posted id wins; an id-less post falls back to the unscoped id (portal#2068, BLIND P3 on #2071)', async () => {
    expect(formOf(await run(['owner'], 'updateMemberRoles:agent-a'))?.id).toBe('updateMemberRoles:agent-a');
    expect(formOf(await run(['owner']))?.id).toBe('updateMemberRoles');
  });
});
