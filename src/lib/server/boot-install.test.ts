import { describe, it, expect, vi } from 'vitest';
import { readProvenance, writeInstallPrompt } from './boot-install';
const owner = { level: 'worker' as const, worker: 'w', app: 'a', agent: 'g' };
const worker = { worker: { id: 'w', app: { id: 'a' }, agent: { id: 'g' }, bootPromptRef: null } };
describe('portal#1666 install compile boundary', () => {
  it('worker compile explicitly never moves the pointer, then independently reads serving', async () => {
    const request = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce({ compileWorkerBootPrompt: { node: { id: 'c' }, revNo: 3 } }).mockResolvedValueOnce({ worker: { bootPromptServe: null } });
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'compile' }, false);
    expect(request.mock.calls[1][1]).toEqual({ workerRef: 'w', setPointer: false });
    expect(request.mock.calls[2][0]).toContain('bootPromptServe');
    expect(result.text).toContain('Built revision 3');
    expect(result.text).toContain('Couldn’t read');
  });
  it('a changed worker identity refuses before any write', async () => {
    const request = vi.fn().mockResolvedValue({ worker: { ...worker.worker, agent: { id: 'other' } } });
    expect((await writeInstallPrompt({ request } as never, owner, { intent: 'start' }, false)).text).toContain('changed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('impersonation refuses before any GraphQL request', async () => {
    const request = vi.fn();
    expect((await writeInstallPrompt({ request } as never, owner, { intent: 'compile' }, true)).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('creates only the fixed empty source through install, never copies text', async () => {
    const request = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce({ createNode: { id: 'src' } });
    await writeInstallPrompt({ request } as never, owner, { intent: 'start' }, false);
    expect(request.mock.calls[1][1]).toEqual({ input: { install: { appRef: 'a', agentRef: 'g' }, loc: 'boot:workers:w:source', name: 'Worker boot prompt source', role: 'boot-prompt', content: '' } });
  });
  it('strips unreadable and deleted source identifiers from the transport', async () => {
    const item = (nodeId: string) => ({ nodeId, depth: 1, revNo: 2, selection: { rev: null, approved: true, signed: false }, pruned: null });
    const request = vi.fn().mockResolvedValueOnce({ compiledPromptProvenance: { items: [item('hidden'), item('deleted')], total: 23, hasMore: true, pruned: false } }).mockResolvedValueOnce({ nodeBatch: { nodes: [], unavailable: ['hidden', 'deleted'], omitted: [] } });
    const page = await readProvenance({ request } as never, 'c', 3, 0);
    expect(page?.items[0]).toEqual(page?.items[1]);
    expect(JSON.stringify(page)).not.toMatch(/hidden|deleted/);
    expect(request.mock.calls[1][0]).not.toContain('content');
    expect(page?.hasMore).toBe(true);
  });
});
