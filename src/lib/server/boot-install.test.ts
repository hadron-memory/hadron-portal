import { describe, it, expect, vi } from 'vitest';
import { PROVENANCE, readInstallPrompt, readProvenance, writeInstallPrompt } from './boot-install';
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
  it.each([
    ['worker', { id: 'other' }],
    ['App', { app: { id: 'other' } }],
    ['Agent', { agent: { id: 'other' } }],
  ])('a changed worker %s identity refuses before any write', async (_arm, change) => {
    const request = vi.fn().mockResolvedValue({ worker: { ...worker.worker, ...change } });
    expect((await writeInstallPrompt({ request } as never, owner, { intent: 'start' }, false)).text).toContain('changed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['non-integer revNo', { node: { id: 'c' }, revNo: '3' }],
    ['missing node id', { node: {}, revNo: 3 }],
    ['empty node id', { node: { id: '' }, revNo: 3 }],
  ])('a resolved compile with %s is unknown and never reads serving', async (_shape, malformed) => {
    const request = vi.fn()
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce({ compileWorkerBootPrompt: malformed })
      .mockResolvedValueOnce({ worker: { bootPromptServe: null } })
      .mockResolvedValueOnce(worker);
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'compile' }, false);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('Couldn’t confirm whether the prompt was built');
    expect(result.text).not.toContain('Nothing changed');
    expect(request).toHaveBeenCalledTimes(2);
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
  it('portal#1901: selects the occurrence kind and order the gate requires and carries them to each row', async () => {
    expect(PROVENANCE).toMatch(/items \{[^}]*\bkind\b[^}]*\}/);
    expect(PROVENANCE).toMatch(/items \{[^}]*\border\b[^}]*\}/);
    const item = { nodeId: 'n1', kind: 'include', order: 4, depth: 1, revNo: 2, selection: { rev: null, approved: false, signed: false }, pruned: false };
    const request = vi.fn().mockResolvedValueOnce({ compiledPromptProvenance: { items: [item], total: 1, hasMore: false, pruned: false } }).mockResolvedValueOnce({ nodeBatch: { nodes: [{ id: 'n1', urn: 'hrn:node:a.com:m:x', name: 'X' }], unavailable: [], omitted: [] } });
    const page = await readProvenance({ request } as never, 'c', 3, 0);
    expect(page?.items[0]).toMatchObject({ kind: 'include', order: 4 });
  });
  it('strips unreadable and deleted source identifiers and retention from the transport, but keeps truncation omission', async () => {
    // hrn:node:hadronmemory.com:specs:cor:api:040: omission is response-size truncation, disjoint from unavailable refs.
    const item = (nodeId: string) => ({ nodeId, depth: 1, revNo: 2, selection: { rev: null, approved: true, signed: false }, pruned: true });
    const request = vi.fn().mockResolvedValueOnce({ compiledPromptProvenance: { items: [item('hidden'), item('deleted'), item('dropped')], total: 23, hasMore: true, pruned: false } }).mockResolvedValueOnce({ nodeBatch: { nodes: [], unavailable: ['hidden', 'deleted'], omitted: ['dropped'] } });
    const page = await readProvenance({ request } as never, 'c', 3, 0);
    expect(page?.items.map(row => ({ omitted: row.omitted, pruned: row.pruned }))).toEqual([{ omitted: false, pruned: null }, { omitted: false, pruned: null }, { omitted: true, pruned: null }]);
    expect(JSON.stringify(page)).not.toMatch(/hidden|deleted|dropped/);
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
  it('CONFLICT has its fixed retry copy and no serving read or serving tail', async () => {
    const request = vi.fn().mockResolvedValueOnce(worker).mockRejectedValueOnce(error('CONFLICT')).mockResolvedValueOnce({ worker: { bootPromptServe: { refusal: null, served: { compiledNodeId: 'c', servedRevSeq: 3, pointerLevel: 'WORKER' } } } });
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'compile' }, false);
    expect(result).toMatchObject({ ok: false, status: 409, text: 'The prompt couldn’t be built right now. Try again.' });
    expect(result.text).not.toContain('Nothing changed');
    expect(result.text).not.toContain('would get');
    expect(request).toHaveBeenCalledTimes(2);
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
  it('a stale approval revision cannot reach approveNode even when the node still matches', async () => {
    const request = approvalClient();
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'approve', nodeId: 'c', revision: 2 }, false);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.text).toContain('This prompt changed');
    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls.some(([doc]) => String(doc).includes('approveNode'))).toBe(false);
  });
  it('approval sends the exact displayed revision and states open sessions keep theirs', async () => {
    const request = approvalClient().mockResolvedValueOnce({ approveNode: {} }).mockResolvedValueOnce({ worker: { bootPromptServe: { served: { compiledNodeId: 'c', servedRevSeq: 3, pointerLevel: 'WORKER' }, refusal: null } } });
    const result = await writeInstallPrompt({ request } as never, owner, { intent: 'approve', nodeId: 'c', revision: 3 }, false);
    expect(result.ok).toBe(true); expect(request.mock.calls[7][1]).toEqual({ nodeRef: 'c', revision: 3 });
    expect(result.text).toContain('Sessions already open keep the revision');
    expect(result.text).not.toMatch(/sign(?!ed in| in)/i);
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
  it('a changed App identity refuses before compile', async () => {
    const request = vi.fn().mockResolvedValueOnce({ app: { id: 'other', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } });
    const result = await writeInstallPrompt({ request } as never, { level: 'app', app: 'a', agent: 'g' }, { intent: 'compile' }, false);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.text).toContain('changed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('an App response without the requested Agent membership refuses before compile', async () => {
    const request = vi.fn().mockResolvedValueOnce({ app: { id: 'a', appAgents: [{ agent: { id: 'other' }, bootPromptRef: null }] } });
    const result = await writeInstallPrompt({ request } as never, { level: 'app', app: 'a', agent: 'g' }, { intent: 'compile' }, false);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.text).toContain('changed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('start is refused for an App owner without creating a node', async () => {
    const request = vi.fn().mockResolvedValueOnce({ app: { id: 'a', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } });
    const result = await writeInstallPrompt({ request } as never, { level: 'app', app: 'a', agent: 'g' }, { intent: 'start' }, false);
    expect(result).toMatchObject({ ok: false, status: 400, text: 'A worker is required.' });
    expect(request.mock.calls.some(([doc]) => String(doc).includes('createNode'))).toBe(false);
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


describe('portal#1857 compile revision boundary', () => {
  for (const level of ['app', 'worker'] as const) {
    it.each([0, -1])(`${level} refuses revNo %s without reading serving`, async revNo => {
      const scope = level === 'worker' ? owner : { level, app: 'a', agent: 'g' };
      const identity = level === 'worker' ? worker : { app: { id: 'a', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } };
      const payload = { node: { id: 'c', revision: revNo }, revNo };
      const request = vi.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce(level === 'worker' ? { compileWorkerBootPrompt: payload } : { compileAppAgentBootPrompt: payload });
      const result = await writeInstallPrompt({ request } as never, scope, { intent: 'compile' }, false);
      expect(result.ok).toBe(false);
      expect(result.text).toContain('Couldn’t confirm whether the prompt was built');
      expect(result.text).not.toContain('Built revision');
      expect(result.text).not.toContain('Nothing changed');
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.some(([query]) => String(query).includes('bootPromptServe'))).toBe(false);
    });
  }
});
