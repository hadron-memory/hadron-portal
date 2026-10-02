/**
 * #992 slice C — POST /app/memories/[id]/mint → mintMemoryNodes. Dry run by
 * default; a refused real run answers with a FRESH report; failures get fixed
 * copy by code, never the server's text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { MINT_MEMORY_NODES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { POST } from './+server';

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const ev = (body: unknown, token: string | null = 'tok') =>
  ({ params: { id: 'mem-1' }, request: { json: async () => body }, locals: { token } }) as unknown as Parameters<typeof POST>[0];

function gqlError(code: string) {
  return new ClientError(
    { errors: [{ message: 'server prose with secrets', extensions: { code } }] as never, status: 200, headers: new Headers() } as never,
    { query: '' },
  );
}
const serverReport = (over: Record<string, unknown> = {}) => ({
  mintMemoryNodes: {
    dryRun: true, minted: false, mintedCount: 0, mintLocs: ['a', 'b'],
    blockers: [], openQuestions: [{ decider: null, questions: [{ loc: 'a' }, { loc: 'b' }] }],
    ...over,
  },
});

describe('mint endpoint (#992)', () => {
  it('401s without a token, without calling the server', async () => {
    expect((await POST(ev({}, null))).status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('is a dry run unless the body says dryRun: false', async () => {
    mockRequest.mockResolvedValue(serverReport());
    for (const body of [{}, { dryRun: 'false' }, null, { dryRun: true }]) {
      mockRequest.mockClear();
      await POST(ev(body));
      expect(mockRequest).toHaveBeenCalledWith(MINT_MEMORY_NODES_MUTATION, { memoryRef: 'mem-1', dryRun: true });
    }
  });

  it('returns counts, not the loc list', async () => {
    mockRequest.mockResolvedValue(serverReport({ blockers: [{ kind: 'LINT', loc: 'a', rule: 'tag-spec', targetLoc: null }] }));
    const { report } = await (await POST(ev({}))).json();
    expect(report).toEqual({
      dryRun: true, minted: false, mintedCount: 0, mintableCount: 2, openQuestionCount: 2,
      blockers: [{ kind: 'LINT', loc: 'a', rule: 'tag-spec', targetLoc: null }],
    });
  });

  it('a real run mints', async () => {
    mockRequest.mockResolvedValue(serverReport({ dryRun: false, minted: true, mintedCount: 2 }));
    const res = await POST(ev({ dryRun: false }));
    expect(mockRequest).toHaveBeenCalledWith(MINT_MEMORY_NODES_MUTATION, { memoryRef: 'mem-1', dryRun: false });
    expect((await res.json()).report).toMatchObject({ dryRun: false, mintedCount: 2 });
  });

  it('a real run refused as blocked answers 409 with a fresh dry-run report', async () => {
    mockRequest
      .mockRejectedValueOnce(gqlError('SPEC_CORPUS_MINT_BLOCKED'))
      .mockResolvedValueOnce(serverReport({ blockers: [{ kind: 'NOT_APPROVED', loc: 'b', rule: null, targetLoc: null }] }));
    const res = await POST(ev({ dryRun: false }));
    expect(res.status).toBe(409);
    expect(mockRequest.mock.calls[1][1]).toEqual({ memoryRef: 'mem-1', dryRun: true });
    const body = await res.json();
    expect(body.report.blockers).toEqual([{ kind: 'NOT_APPROVED', loc: 'b', rule: null, targetLoc: null }]);
    expect(body.error).toContain('nothing was minted');
  });

  it('a blocked refusal whose fresh check also fails promises no list', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('SPEC_CORPUS_MINT_BLOCKED')).mockRejectedValueOnce(new Error('down'));
    const res = await POST(ev({ dryRun: false }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.report).toBeUndefined();
    expect(body.error).toBe('Something now blocks minting, so nothing was minted. Check again to see what.');
  });

  it('an unknown failure of a dry run is a failed check, not an unknown mint (Codex on #996)', async () => {
    mockRequest.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR'));
    const res = await POST(ev({}));
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toBe("Couldn't check this memory. Try again.");
  });

  it.each([
    ['SPEC_CORPUS_BUSY', 503, 'Try again in a moment'],
    ['SPEC_CORPUS_ENCRYPTED_UNSUPPORTED', 422, "can't be minted"],
    ['FORBIDDEN', 403, "don't have permission"],
    ['INTERNAL_SERVER_ERROR', 500, 'may or may not have gone through'],
  ])('%s → %i with fixed copy', async (code, status, copy) => {
    mockRequest.mockRejectedValue(gqlError(code));
    const res = await POST(ev({ dryRun: false }));
    expect(res.status).toBe(status);
    const { error } = await res.json();
    expect(error).toContain(copy);
    expect(error).not.toContain('server prose');
  });
});
