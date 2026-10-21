import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_AGENT_MUTATION } from '$lib/server/queries';
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
  it('clears an empty prompt with null', async () => {
    await save('');
    expect(request).toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, { ref: 'agent-1', systemPrompt: null });
  });
});
