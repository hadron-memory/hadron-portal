import { beforeEach, expect, it, vi } from 'vitest';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => request.mockReset());
async function submit(fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  expect(typeof actions.createMemory).toBe('function');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return actions.createMemory({ request: { formData: async () => fd }, params: { appId: 'route-app' }, locals: { token: 'synthetic' } } as never);
}
const valid = { _kind: 'createAppMemory', name: 'Project notes', description: 'Shared project notes' };
it('creates a NEW memory on the route App without agent, class or existing-memory operands', async () => {
  request.mockResolvedValue({ createAppMemory: { id: 'm1', urn: 'hrn:mem:acme.com:project-notes', name: 'Project notes' } });
  const result = await submit({ ...valid, appRef: 'other-app', memoryRef: 'old-memory', memoryClass: 'system', agentRef: 'foreign-agent' });
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toContain('createAppMemory');
  expect(request.mock.calls[0][1]).toEqual({ appRef: 'route-app', name: valid.name, description: valid.description });
  expect((result as any).form.message.type).toBe('success');
});
it.each([{...valid,name:'  '},{...valid,_kind:'deleteApp'}])('rejects invalid fields without mutating', async fields => {
  const result = await submit(fields);
  expect((result as any).status).toBe(400);
  expect(request).not.toHaveBeenCalled();
});
it.each([
  ['FORBIDDEN',403,'organization'],['UNAUTHENTICATED',401,'Sign in'],
  ['AGENT_NOT_INSTALLED',409,'Install'],['USER_OWNED_APP_UNSUPPORTED',400,'organization'],
  ['INTERNAL_SERVER_ERROR',500,'try again'],['FUTURE_CODE',500,'try again'],
])('maps %s to fixed copy without reflecting server diagnostics', async (code,status,copy) => {
  request.mockRejectedValue({response:{errors:[{message:'secret SQL /private/path',extensions:{code}}]}});
  const result = await submit(valid) as any;
  expect(result.status).toBe(status);expect(result.data.form.message.text).toContain(copy);
  expect(JSON.stringify(result)).not.toContain('secret SQL');
});
it('transport errors never leak request or server text',async()=>{
 request.mockRejectedValue(new Error('secret SQL /private/path'));
 const result=await submit(valid) as any;
 expect(result.status).toBe(500);expect(JSON.stringify(result)).not.toContain('secret SQL');
});
