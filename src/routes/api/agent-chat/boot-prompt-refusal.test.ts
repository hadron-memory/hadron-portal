/**
 * portal#1665 Ask 1: a boot prompt the server refuses to serve reaches the chat
 * user as one fixed, code-specific message (409, `{error, code}`), never as the
 * generic "Chat request failed. Please try again." and never carrying the
 * server's own prose or extensions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
const mockRunChatTurn = vi.fn();
vi.mock('$lib/server/llm/agentChatTurn', () => ({ runChatTurn: mockRunChatTurn }));
vi.mock('$lib/server/llm/agentChatTurn.js', () => ({ runChatTurn: mockRunChatTurn }));

const SENTINELS = ['node-id-SENTINEL', 'hrn:node:leak.example:loc-SENTINEL', 'rev-SENTINEL-77', '<script>SENTINEL</script>', 'agent-name-SENTINEL', 'surface-SENTINEL', 'extra-SENTINEL'];

const CASES = [
  ['BOOT_PROMPT_NOT_SET', 'bootPromptNotSet', /no boot prompt set up/, /Trying again won't help until they do\.$/],
  ['BOOT_PROMPT_TARGET_DELETED', 'bootPromptTargetDeleted', /boot prompt was removed/, /Trying again won't help until they do\.$/],
  ['BOOT_PROMPT_NOT_APPROVED', 'bootPromptNotApproved', /No approved version/, /Trying again won't help until they do\.$/],
  ['BOOT_PROMPT_NOT_SIGNED', 'bootPromptNotSigned', /No signed version/, /Trying again won't help until they do\.$/],
  ['BOOT_PROMPT_RECORDED_REVISION_DELETED', 'bootPromptRecordedRevisionDeleted', /has been deleted, so it can't continue\. Start a new chat\.$/, /^(?![\s\S]*Trying again)/],
] as const;

function refusal(code: string) {
  const message = SENTINELS.join(' | ');
  return Object.assign(new Error(message), {
    response: { errors: [{ message, extensions: { code, surface: 'surface-SENTINEL', agentName: 'agent-name-SENTINEL', extra: 'extra-SENTINEL' } }] },
  });
}
const ev = (body: unknown) => ({ request: { json: async () => body }, locals: { token: 't' }, url: new URL('http://localhost/x') }) as any;
const read = async (res: Response) => JSON.parse(await res.text());
function expectFixed(body: { error: string; code: string }, code: string, copy: RegExp, tail: RegExp) {
  expect(body.code).toBe(code);
  expect(body.error).toMatch(copy);
  expect(body.error).toMatch(tail);
  for (const s of SENTINELS) expect(JSON.stringify(body)).not.toContain(s);
  expect(body.error).not.toMatch(/Chat request failed/);
  // The copy never names the level that decides, and never says approving the Agent's own prompt fixes it.
  expect(body.error).not.toMatch(/\b(App-level|worker-level)\b/i);
}

let logged: unknown[][];
beforeEach(() => {
  mockRequest.mockReset();
  mockRunChatTurn.mockReset();
  logged = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logged.push(a));
});
afterEach(() => vi.restoreAllMocks());

describe.each(CASES)('%s', (serverCode, portalCode, copy, tail) => {
  it('start answers 409 {error, code} with the fixed message and no server text', async () => {
    mockRequest.mockRejectedValueOnce(refusal(serverCode));
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ agentId: 'a1' }));
    expect(res.status).toBe(409);
    expectFixed(await read(res), portalCode, copy, tail);
    expect(mockRequest).toHaveBeenCalledTimes(1); // no retry, no lookup
    expect(mockRunChatTurn).not.toHaveBeenCalled(); // no welcome turn
    for (const s of SENTINELS) expect(JSON.stringify(logged)).not.toContain(s);
  });

  it('turn answers 409 {error, code} with the fixed message and no server text', async () => {
    mockRunChatTurn.mockRejectedValueOnce(refusal(serverCode));
    const { POST } = await import('./turn/+server');
    const res = await POST(ev({ agentId: 'a1', chatId: 'c1', userMessage: 'hi' }));
    expect(res.status).toBe(409);
    expectFixed(await read(res), portalCode, copy, tail);
    expect(mockRunChatTurn).toHaveBeenCalledTimes(1); // no automatic retry
    for (const s of SENTINELS) expect(JSON.stringify(logged)).not.toContain(s);
  });
});

describe('everything else keeps today\'s behaviour', () => {
  it('an unknown code on turn is still the generic failure (500)', async () => {
    mockRunChatTurn.mockRejectedValueOnce(refusal('BOOT_PROMPT_SOMETHING_NEW'));
    const { POST } = await import('./turn/+server');
    const res = await POST(ev({ agentId: 'a1', chatId: 'c1', userMessage: 'hi' }));
    expect(res.status).toBe(500);
    expect(await read(res)).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
  });

  it('an unknown code on start is still the generic failure (500)', async () => {
    mockRequest.mockRejectedValueOnce(refusal('BOOT_PROMPT_SOMETHING_NEW'));
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ agentId: 'a1' }));
    expect(res.status).toBe(500);
    expect((await read(res)).error).toBe('Chat request failed. Please try again.');
  });

  it('INTERNAL_SERVER_ERROR on start keeps its existing text', async () => {
    const e = Object.assign(new Error('boom'), { response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR', requestId: 'req-1234' } }] } });
    mockRequest.mockRejectedValueOnce(e);
    const { POST } = await import('./start/+server');
    const res = await POST(ev({ agentId: 'a1' }));
    expect(res.status).toBe(500);
    expect((await read(res)).error).not.toMatch(/boot prompt/i);
  });
});
