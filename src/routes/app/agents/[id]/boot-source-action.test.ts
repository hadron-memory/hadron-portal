import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROVE_NODE_MUTATION, COMPILE_AGENT_BOOT_PROMPT_MUTATION, NODE_DATA_READ_QUERY, UPDATE_AGENT_MUTATION, UPDATE_NODE_MUTATION } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => { request.mockReset(); request.mockResolvedValue({}); });
describe('portal#1377 S1 saveBootSource', () => {
  async function saveSource(content: string, extra: Record<string, string> = {}) {
    const { actions } = await import('./+page.server');
    const fd = new FormData();
    fd.set('_kind', 'bootSource');
    fd.set('nodeId', 'node-src');
    fd.set('expectedRevision', '3');
    fd.set('content', content);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return actions.saveBootSource!({ request: { formData: async () => fd }, params: { id: 'agent-1' }, locals: { token: 'tok' } } as never);
  }
  const refusal = (code: string) => Object.assign(new Error('private upstream detail {{secret}}'), { response: { errors: [{ message: 'server prose', extensions: { code } }] } });

  it('writes the source node with the opened revision, never the Agent field', async () => {
    request.mockResolvedValueOnce({ node: { role: 'boot-prompt', isRunnable: false } }).mockResolvedValueOnce({ updateNode: { revision: 4 } });
    await saveSource('  see {{> policies:conduct}}\r\nbye\r\n');
    expect(request).toHaveBeenNthCalledWith(1, NODE_DATA_READ_QUERY, { ref: 'node-src' });
    expect(request).toHaveBeenCalledWith(UPDATE_NODE_MUTATION, { input: { id: 'node-src', content: '  see {{> policies:conduct}}\nbye\n', expectedRevision: 3 } });
    expect(request).not.toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, expect.anything());
  });
  it('says workers still wait for compile and approval after a save', async () => {
    request.mockResolvedValueOnce({ node: null }).mockResolvedValueOnce({ updateNode: { revision: 4 } });
    const r = await saveSource('x') as { form: { message: { text: string } } };
    expect(r.form.message.text).not.toMatch(/\(revision/);
    expect(r.form.message.text).toContain('compiled and approved');
  });
  it.each([
    ['NODE_WRITE_CONFLICT', 409, 'copy it before you reload'],
    ['BOOT_PROMPT_WORKER_SESSION_REFUSED', 403, 'not through a worker session'],
    ['INCLUDE_TARGET_UNAVAILABLE', 422, 'doesn’t exist or that you can’t read'],
    ['FORBIDDEN', 403, 'Only whoever manages this Agent'],
    ['SOMETHING_ELSE', 500, 'Your draft is kept'],
  ])('%s maps to fixed copy and keeps the draft', async (code, status, copy) => {
    request.mockResolvedValueOnce({ node: null }).mockRejectedValueOnce(refusal(code));
    const r = await saveSource(' draft {{x}}\n') as { status: number; data: { form: { data: { content: string }; message: { text: string } } } };
    expect(r.status).toBe(status);
    expect(r.data.form.data.content).toBe(' draft {{x}}\n');
    expect(r.data.form.message.text).toContain(copy);
    expect(r.data.form.message.text).not.toContain('server prose');
    expect(r.data.form.message.text).not.toContain('private upstream');
  });
});

describe('portal#1377 S2 compile and approve actions', () => {
  const refusal = (code: string, extensions: Record<string, unknown> = {}) => Object.assign(new Error('private {{secret}}'), { response: { errors: [{ message: 'server prose', extensions: { code, ...extensions } }] } });
  async function run(name: 'compileBootPrompt' | 'approveBootPrompt', fields: Record<string, string>) {
    const { actions } = await import('./+page.server');
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return actions[name]!({ request: { formData: async () => fd }, params: { id: 'agent-1' }, locals: { token: 'tok' } } as never) as Promise<{ status?: number; form?: { message: { text: string } }; data?: { form: { message: { text: string } } } }>;
  }
  it('compile sends only the agent ref (server default setPointer) and claims nothing about approval', async () => {
    request.mockResolvedValueOnce({ compileAgentBootPrompt: { revNo: 6 } });
    const r = await run('compileBootPrompt', { _kind: 'bootCompile' });
    expect(request).toHaveBeenCalledWith(COMPILE_AGENT_BOOT_PROMPT_MUTATION, { agentRef: 'agent-1' });
    expect(r.form!.message.text).toBe('Built revision 6.');
  });
  it('a refused compile maps by code, names the position, never echoes server prose, and says nothing changed', async () => {
    request.mockRejectedValueOnce(refusal('BOOT_PROMPT_INCLUDE_BROKEN', { position: 12 }));
    request.mockResolvedValueOnce({ agent: { bootPromptRef: 'ref' } }).mockResolvedValueOnce({ node: { id: 'c', urn: 'u', revision: 3, content: '', approvalStatus: { state: 'APPROVED', approval: { revision: 3 } }, lintWarnings: null } });
    const r = await run('compileBootPrompt', { _kind: 'bootCompile' });
    expect(r.status).toBe(422);
    const text = r.data!.form.message.text;
    expect(text).toContain('character 12');
    expect(text).toContain('workers still get revision 3');
    expect(text).not.toContain('server prose');
    expect(text).not.toContain('secret');
  });
  it('approve sends the compiled node id and the revision the manager read', async () => {
    request.mockResolvedValueOnce({ approveNode: { nodeId: 'c1' } });
    const r = await run('approveBootPrompt', { _kind: 'bootApprove', nodeId: 'c1', revision: '5' });
    expect(request).toHaveBeenCalledWith(APPROVE_NODE_MUTATION, { nodeRef: 'c1', revision: 5 });
    expect(r.form!.message.text).toBe('Revision 5 approved. Workers bound from now on get it.');
  });
  it.each([
    ['REVISION_MISMATCH', 409, 'nothing was approved. The page has reloaded'],
    ['BOOT_PROMPT_APPROVAL_FORBIDDEN', 403, 'Only whoever manages this Agent'],
  ])('approve %s is %i with fixed copy', async (code, status, copy) => {
    request.mockRejectedValueOnce(refusal(code));
    const r = await run('approveBootPrompt', { _kind: 'bootApprove', nodeId: 'c1', revision: '5' });
    expect(r.status).toBe(status);
    expect(r.data!.form.message.text).toContain(copy);
    expect(r.data!.form.message.text).not.toContain('server prose');
  });
});
