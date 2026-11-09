import { describe, expect, it, vi } from 'vitest';
import { writeInstallPrompt } from './boot-install';

describe('portal#1674 compile copy follows returned approval, not serving', () => {
  it.each(['worker', 'app'] as const)('reports retained approval for the %s result without inferring serving', async level => {
    const owner = level === 'worker' ? { level, worker: 'w', app: 'a', agent: 'g' } : { level, app: 'a', agent: 'g' };
    const identity = level === 'worker' ? { worker: { id: 'w', app: { id: 'a' }, agent: { id: 'g' }, bootPromptRef: null } } : { app: { id: 'a', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } };
    const payload = { revNo: 3, node: { id: 'c', urn: 'hrn:node:example.com:install:boot:compiled', revision: 3, approvalStatus: { state: 'APPROVED' } } };
    const request = vi.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce(level === 'worker' ? { compileWorkerBootPrompt: payload } : { compileAppAgentBootPrompt: payload }).mockResolvedValueOnce(level === 'worker' ? { worker: { bootPromptServe: null } } : { app: { appAgents: [{ agent: { id: 'g' }, bootPromptServe: null }] } }).mockResolvedValueOnce(identity);
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'compile' }, false);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Its existing approval still applies.');
    expect(result.text).not.toMatch(/sign(?!ed in| in)/i);
    expect(result.text).not.toContain('isn’t approved yet');
    expect(result.text).toContain('Couldn’t read');
    expect(request.mock.calls[1][0]).toMatch(/node\s*\{[^}]*revision[^}]*approvalStatus\s*\{\s*state/);
    expect(request.mock.calls[2][0]).toContain('bootPromptServe');
  });
  it.each([
    ['NOT_APPROVED', 3, 'It isn’t approved yet.'],
    ['SUPERSEDED', 3, 'It isn’t approved yet.'],
    ['APPROVED', 4, 'Couldn’t confirm its approval state.'],
    ['NOT_APPLICABLE', 3, 'Couldn’t confirm its approval state.'],
    [undefined, 3, 'Couldn’t confirm its approval state.'],
  ])('handles state %s at node revision %s honestly', async (state, revision, copy) => {
    const worker = { worker: { id: 'w', app: { id: 'a' }, agent: { id: 'g' }, bootPromptRef: null } };
    const request = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce({ compileWorkerBootPrompt: { revNo: 3, node: { id: 'c', revision, approvalStatus: state ? { state } : null } } }).mockResolvedValueOnce({ worker: { bootPromptServe: { refusal: null, served: { compiledNodeId: 'other', servedRevSeq: 1, pointerLevel: 'APP_AGENT' } } } }).mockResolvedValueOnce(worker);
    const result = await writeInstallPrompt({ request } as never, { level: 'worker', worker: 'w', app: 'a', agent: 'g' }, { intent: 'compile' }, false);
    expect(result.text).toContain(copy);
    expect(result.text).not.toMatch(/sign(?!ed in| in)/i);
    expect(result.text).toContain('revision 1');
    if (copy.startsWith('Couldn’t')) expect(result.text).not.toContain('isn’t approved yet');
  });
});
