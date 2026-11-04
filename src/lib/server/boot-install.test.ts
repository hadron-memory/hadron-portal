import { describe, it, expect, vi } from 'vitest';
import { readInstallPrompt, readProvenance, writeInstallPrompt } from './boot-install';
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
    expect(request.mock.calls[1][0]).toContain('createNode');
    expect(request.mock.calls[1][0]).not.toContain('updateNode');
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

describe('compile and approval outcomes', () => {
  const error = (code: string) => ({ response: { errors: [{ extensions: { code }, message: 'private upstream prose' }] } });
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN', null])('unknown compile %s never says nothing changed', async code => {
    const request = vi.fn().mockResolvedValueOnce(worker).mockRejectedValueOnce(code ? error(code) : new Error('socket'));
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'compile' }, false);
    expect(result.ok).toBe(false); expect(result.text).toContain('Couldn’t confirm whether'); expect(result.text).not.toContain('Nothing changed');
  });
  it('source loc race refuses create without an update or retry', async () => {
    const request = vi.fn().mockResolvedValueOnce(worker).mockRejectedValueOnce(error('NodeLocConflictError'));
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'start' }, false);
    expect(result.text).toContain('already has a source'); expect('status' in result && result.status).toBe(409);
    expect(request).toHaveBeenCalledTimes(2);
  });
  const install = { installMemory: { id: 'install', urn: 'hrn:mem:example.com:install' } };
  const node = { node: { id: 'c', urn: 'hrn:node:example.com:install:boot:compiled', revision: 3, content: 'compiled', approvalStatus: { state: 'NOT_APPROVED', approval: null }, lintWarnings: null } };
  function approvalClient() {
    return vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce(worker).mockResolvedValueOnce(install).mockResolvedValueOnce({ node: null }).mockResolvedValueOnce(install).mockResolvedValueOnce({ node: { id: 'c' } }).mockResolvedValueOnce(node);
  }
  it.each(['UNKNOWN', 'INTERNAL_SERVER_ERROR', null])('approval %s after send remains unknown and never reads serving', async code => {
    const request = approvalClient().mockRejectedValueOnce(code ? error(code) : new Error('socket'));
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'approve', nodeId: 'c', revision: 3 }, false);
    expect(result.ok).toBe(false); expect(result.text).toContain('Couldn’t confirm the approval');
    expect(request).toHaveBeenCalledTimes(8);
    expect(result.text).not.toContain('would get');
  });
  it('a forged approval for a different node cannot reach approveNode', async () => {
    const request = approvalClient();
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'approve', nodeId: 'foreign', revision: 3 }, false);
    expect(result.ok).toBe(false); expect(request).toHaveBeenCalledTimes(7);
  });
  it('approval sends the exact displayed revision and states open sessions keep theirs', async () => {
    const request = approvalClient().mockResolvedValueOnce({ approveNode: {} }).mockResolvedValueOnce({ worker: { bootPromptServe: { served: { compiledNodeId: 'c', servedRevSeq: 3, pointerLevel: 'WORKER' }, refusal: null } } });
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'approve', nodeId: 'c', revision: 3 }, false);
    expect(result.ok).toBe(true); expect(request.mock.calls[7][1]).toEqual({ nodeRef: 'c', revision: 3 });
    expect(result.text).toContain('Sessions already open keep the revision');
    expect(result.text).toContain('next bind would get revision 3');
  });
});

describe('App scope and source reads', () => {
  it('App compile uses only the installed row identity; no setPointer option is sent', async () => {
    const request = vi.fn().mockResolvedValueOnce({ app: { id: 'a', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } }).mockResolvedValueOnce({ compileAppAgentBootPrompt: { node: { id: 'c', revision: 2, approvalStatus: { state: 'NOT_APPROVED' } }, revNo: 2 } }).mockResolvedValueOnce({ app: { appAgents: [{ agent: { id: 'g' }, bootPromptServe: { refusal: 'BOOT_PROMPT_NOT_APPROVED', served: null } }] } });
    const result = await writeInstallPrompt({ request } as never, { level: 'app', app: 'a', agent: 'g' }, { intent: 'compile' }, false);
    expect(request.mock.calls[1][1]).toEqual({ appRef: 'a', agentRef: 'g' });
    expect(result.text).toContain('Built revision 2. It isn’t approved yet.');
    expect(result.text).toContain('no approved revision is available');
  });
  it('failed existence read never offers a start', async () => {
    const { readInstallPrompt } = await import('./boot-install');
    const request = vi.fn().mockResolvedValueOnce(worker).mockResolvedValueOnce({ installMemory: { id: 'm' } }).mockRejectedValueOnce(new Error('unreadable')).mockResolvedValueOnce({ installMemory: null });
    const view = await readInstallPrompt({ request } as never, owner);
    expect(view.canStart).toBe(false); expect(view.source).toBeNull();
  });
});


describe('compiled read availability and approval preflight', () => {
  const app = { level: 'app' as const, app: 'a', agent: 'g' };
  const identity = { app: { id: 'a', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } };
  it('distinguishes a failed compiled read from an absent compiled node', async () => {
    const failed = vi.fn().mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error('private transport failure'));
    const absent = vi.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce({ installMemory: null });
    expect(await readInstallPrompt({ request: failed } as never, app)).toMatchObject({ compiled: null, compiledReadFailed: true });
    expect(await readInstallPrompt({ request: absent } as never, app)).toMatchObject({ compiled: null, compiledReadFailed: false });
  });
  it('reports an unavailable known compiled node honestly even when readCompiled returns null', async () => {
    const request = vi.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce({ installMemory: { id: 'm' } }).mockResolvedValueOnce({ node: { id: 'c' } }).mockRejectedValueOnce(new Error('private'));
    expect(await readInstallPrompt({ request } as never, app)).toMatchObject({ compiled: null, compiledReadFailed: true });
  });
  it.each(['identity', 'compiled'])('a failed %s approval preflight says no request sent and never approves', async stage => {
    const request = vi.fn().mockResolvedValueOnce(identity);
    if (stage === 'identity') request.mockRejectedValueOnce(new Error('private'));
    else request.mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error('private'));
    const result = await writeInstallPrompt({ request } as never, app, { intent: 'approve', nodeId: 'c', revision: 3 }, false);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.text).toContain('No approval request was sent.');
    expect(result.text).not.toContain('private');
    expect(request.mock.calls.some(([doc]) => String(doc).includes('approveNode'))).toBe(false);
  });
});
