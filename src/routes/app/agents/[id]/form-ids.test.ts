/**
 * #1320 — every form the Agent page's loader returns has a Superforms id of its
 * own. Add memory and Change role were both `{ _kind, memoryId, role }`, so they
 * hashed to one id and shared one client store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds, formIdsOf } from '$lib/test/expectDistinctFormIds';
import { agent } from './page-fixture';

const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { actions, load } from './+page.server';

beforeEach(() => {
  request.mockReset();
  // The Agent is the only read the forms depend on; every other read comes back
  // empty, which the loader treats as "none".
  request.mockImplementation(async (_doc: string, vars: Record<string, unknown>) => (
    vars?.ref === 'ag-1' ? { agent: agent('ag-1') } : {}
  ));
});

describe('Agent page loader', () => {
  it('#1320 gives every form its own Superforms id', async () => {
    const data = await load({ params: { id: 'ag-1' }, locals: { token: 'tok', user: { id: 'user-1' } }, url: new URL('http://localhost/app/agents/ag-1') } as never);
    expectDistinctFormIds(data, 9);
    expect(formIdsOf(data).map((f) => f.key)).toEqual(expect.arrayContaining(['addMemoryForm', 'updateMemoryRoleForm', 'memberRolesForm']));
  });

  it.each([
    ['addMemory', 'addMemoryForm'],
    ['updateMemoryRole', 'updateMemoryRoleForm'],
    ['updateMemberRoles', 'memberRolesForm'],
  ] as const)('the %s action answers under the id its form was loaded with', async (action, formName) => {
    const data = await load({ params: { id: 'ag-1' }, locals: { token: 'tok', user: { id: 'user-1' } }, url: new URL('http://localhost/app/agents/ag-1') } as never);
    // An empty post fails validation, so no mutation runs and the action returns its form.
    const loadedId = formIdsOf(data).find((f) => f.key === formName)?.id;
    // portal#2068: the member-roles form posts the id it was loaded with and the action answers under it.
    const body = new FormData();
    if (action === 'updateMemberRoles') body.set('__superform_id', loadedId!);
    const result = (await actions[action]({ request: new Request('http://localhost/', { method: 'POST', body }), params: { id: 'ag-1' }, locals: { token: 'tok' } } as never)) as unknown as { data: { form: { id: string } } };
    expect(result.data.form.id).toBe(loadedId);
  });

  it('#2068 scopes the member-roles form to the Agent the server returned, whichever spelling reached it', async () => {
    const idOf = async (route: string, agentId: string) => {
      request.mockImplementation(async (_doc: string, vars: Record<string, unknown>) => (vars?.ref === route ? { agent: agent(agentId) } : {}));
      const data = await load({ params: { id: route }, locals: { token: 'tok', user: { id: 'user-1' } }, url: new URL(`http://localhost/app/agents/${route}`) } as never);
      return formIdsOf(data).find((f) => f.key === 'memberRolesForm')?.id;
    };
    const a = await idOf('ag-a', 'ag-a');
    const b = await idOf('ag-b', 'ag-b');
    expect(a).not.toBe(b);
    // The same Agent by its URN: one identity for the fence, taken from the loaded data.
    expect(await idOf('hrn:agent:ada:ag-a', 'ag-a')).toBe(a);
  });
});
