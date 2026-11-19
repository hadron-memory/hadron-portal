import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEC_DOCUMENT_NODE_QUERY, SPEC_DOCUMENT_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { load } from './+page.server';

beforeEach(() => { mockRequest.mockReset(); });

const event = (id = 'mem-1', nodeId = 'node-1') => ({ params: { id, nodeId }, locals: { token: 't' } }) as unknown as Parameters<typeof load>[0];
const run = async (e = event()) => (await load(e)) as { document: Record<string, unknown> };
const specNode = (extra = {}) => ({ node: { id: 'node-1', memoryId: 'mem-1', loc: 'cor:agt:110', name: 'A Feature', urn: 'hrn:node:o.test:m:cor:agt:110', role: 'spec.feature', ...extra } });
const refusal = (code: string, extra: Record<string, unknown> = {}) => ({ response: { errors: [{ message: 'm', extensions: { code, ...extra } }] } });

function serve(doc: () => unknown, node: unknown = specNode()) {
  mockRequest.mockImplementation(async (q: string) => {
    if (q === SPEC_DOCUMENT_NODE_QUERY) return node;
    if (q === SPEC_DOCUMENT_QUERY) return doc();
    throw new Error('unexpected request ' + String(q).slice(0, 60));
  });
}

describe('document load', () => {
  it('returns the server markdown byte for byte', async () => {
    const md = '<a id="cor-agt-110"></a>\n\n# Feature é\n\ntail\n';
    serve(() => ({ specDocument: { loc: 'cor:agt:110', markdown: md } }));
    expect((await run()).document).toEqual({ state: 'ok', loc: 'cor:agt:110', name: 'A Feature', urn: 'hrn:node:o.test:m:cor:agt:110', markdown: md });
    expect(mockRequest).toHaveBeenCalledWith(SPEC_DOCUMENT_QUERY, { memoryRef: 'mem-1', loc: 'cor:agt:110' });
  });
  it('shows the SAME state for an unreadable node, a non-spec node, and the server not-found codes', async () => {
    serve(() => { throw new Error('unreached'); }, { node: null });
    const unreadable = (await run()).document;
    serve(() => { throw new Error('unreached'); }, specNode({ role: 'special' }));
    const nonSpec = (await run()).document;
    serve(() => { throw refusal('MEMORY_NOT_FOUND'); });
    const memory = (await run()).document;
    serve(() => { throw refusal('NODE_NOT_FOUND'); });
    const missing = (await run()).document;
    expect(unreadable).toEqual({ state: 'not-found' });
    for (const other of [nonSpec, memory, missing]) expect(other).toEqual(unreadable);
  });
  it('classifies a refusal of the FIRST (node) query like the second: not-found, encrypted, and unclassified rethrown', async () => {
    mockRequest.mockImplementation(async () => { throw refusal('NODE_NOT_FOUND'); });
    expect((await run()).document).toEqual({ state: 'not-found' });
    mockRequest.mockImplementation(async () => { throw refusal('SPEC_CORPUS_ENCRYPTED_UNSUPPORTED'); });
    expect((await run()).document).toEqual({ state: 'encrypted' });
    mockRequest.mockImplementation(async () => { throw refusal('FORBIDDEN'); });
    await expect(run()).rejects.toBeTruthy();
  });
  it('never asks the server for a document of a non-spec node', async () => {
    serve(() => { throw new Error('unreached'); }, specNode({ role: null }));
    await run();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
  it('encrypted and too-large keep their own plain states, the cap only if numeric', async () => {
    serve(() => { throw refusal('SPEC_CORPUS_ENCRYPTED_UNSUPPORTED', { memoryId: 'secret-id' }); });
    expect((await run()).document).toEqual({ state: 'encrypted' });
    serve(() => { throw refusal('SPEC_DOCUMENT_TOO_LARGE', { cap: 300, limit: 'nodes', maxBytes: 9 }); });
    expect((await run()).document).toEqual({ state: 'too-large', cap: 300, limit: 'nodes' });
  });
  it('lets an unclassified failure reach the error page', async () => {
    serve(() => { throw refusal('FORBIDDEN'); });
    await expect(run()).rejects.toBeTruthy();
  });
  it('redirects to the node memory when the URL names a different one', async () => {
    serve(() => ({ specDocument: { loc: 'x', markdown: '' } }), specNode({ memoryId: 'mem-2' }));
    await expect(run()).rejects.toMatchObject({ status: 303, location: '/app/memories/mem-2/nodes/node-1/document' });
  });
  it('is read only: every document it sends is a query', async () => {
    expect(SPEC_DOCUMENT_NODE_QUERY.trim().startsWith('query')).toBe(true);
    expect(SPEC_DOCUMENT_QUERY.trim().startsWith('query')).toBe(true);
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./+page.server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/_MUTATION|export const actions/);
  });
});
