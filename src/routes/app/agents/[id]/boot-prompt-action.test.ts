import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_DATA_READ_QUERY, UPDATE_AGENT_MUTATION, UPDATE_NODE_MUTATION } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => { request.mockReset(); request.mockResolvedValue({}); });
async function save(prompt: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('_kind', 'bootPrompt');
  fd.set('systemPrompt', prompt);
  return actions.updateBootPrompt!({ request: { formData: async () => fd }, params: { id: 'agent-1' }, locals: { token: 'tok' } } as never);
}
describe('#999 prompt-only action', () => {
  it('preserves raw template bytes and updates only the prompt', async () => {
    const prompt = '  # Hello\n\n{{worker.name}}\n';
    await save(prompt);
    expect(request).toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, { ref: 'agent-1', systemPrompt: prompt });
  });
  it('a backend refusal keeps the raw draft and returns a generic error', async () => {
    request.mockRejectedValueOnce(new Error('private upstream detail'));
    const result = await save(' draft\n') as { status: number; data: { form: { data: { systemPrompt: string }; message: { text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.systemPrompt).toBe(' draft\n');
    expect(result.data.form.message.text).not.toContain('private upstream detail');
  });
  it('normalizes multipart CRLF without trimming source or compiling placeholders', async () => {
    await save('  # Hello\r\n\r\n{{worker.name}}\r\n');
    expect(request).toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, {
      ref: 'agent-1', systemPrompt: '  # Hello\n\n{{worker.name}}\n',
    });
  });
  it('clears an empty prompt with null', async () => {
    await save('');
    expect(request).toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, { ref: 'agent-1', systemPrompt: null });
  });
});

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
    ['NODE_WRITE_CONFLICT', 409, 'Your draft is kept'],
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
