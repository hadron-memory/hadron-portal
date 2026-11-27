/**
 * portal#1665 — a chat the server refuses because it can't serve a boot prompt
 * must say what is wrong, not "Please try again" (a retry gets the same
 * refusal). Keyed ONLY on extensions.code; the server's message, agentName,
 * surface and any other extension never reach the reader or the log.
 *
 * The expected copy is restated here on purpose, independent of chatError.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
const runChatTurn = vi.fn();
vi.mock('$lib/server/llm/agentChatTurn.js', () => ({ runChatTurn: (...a: unknown[]) => runChatTurn(...a) }));

const SENTINELS = ['sentinel-node-01HZZ', '/srv/sentinel/loc', 'sentinel-agent-name', 'sentinel-surface', 'sentinel-rev-99', '<script>sentinel</script>'];

const REFUSALS = [
  ['BOOT_PROMPT_NOT_SET', 'bootPromptNotSet', "This Agent has no boot prompt set up, so the chat can't run. Whoever manages the Agent or this App has to set one up. Trying again won't help until they do."],
  ['BOOT_PROMPT_TARGET_DELETED', 'bootPromptTargetDeleted', "This Agent's boot prompt was removed, so the chat can't run until whoever manages it sets a new one. Trying again won't help until they do."],
  ['BOOT_PROMPT_NOT_APPROVED', 'bootPromptNotApproved', "No approved version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it approves one. Trying again won't help until they do."],
  ['BOOT_PROMPT_NOT_SIGNED', 'bootPromptNotSigned', "No signed version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it signs one. Trying again won't help until they do."],
  ['BOOT_PROMPT_RECORDED_REVISION_DELETED', 'bootPromptRecordedRevisionDeleted', "The boot prompt version this conversation was given has been deleted, so it can't continue. Start a new chat."],
  // portal#1786 (hadron-server#3626): the owner of a personal App stopped qualifying for its organization Agent.
  ['BOOT_PROMPT_INSTALL_LICENSE_INACTIVE', 'bootPromptInstallLicenseInactive', "The owner of this App no longer qualifies to use this organization Agent, so the chat can't run. Trying again won't help."],
] as const;

function refusal(code: string) {
  return {
    response: {
      errors: [
        {
          message: `boot prompt refused for ${SENTINELS[2]} at ${SENTINELS[1]} node ${SENTINELS[0]} ${SENTINELS[5]}`,
          extensions: { code, surface: SENTINELS[3], agentName: SENTINELS[2], nodeId: SENTINELS[0], revision: SENTINELS[4] },
        },
      ],
    },
  };
}

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId: 'app-1', ...(body as object) }) });

const consoleSpies = () =>
  (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
const loggedText = (spies: ReturnType<typeof consoleSpies>) => JSON.stringify(spies.flatMap((s) => s.mock.calls));

beforeEach(() => {
  request.mockReset();
  runChatTurn.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe.each(REFUSALS)('%s', (serverCode, portalCode, message) => {
  it('start: a startChat refusal is a fixed 409 {error, code}, no retry, nothing leaked', async () => {
    const spies = consoleSpies();
    request.mockRejectedValue(refusal(serverCode));
    const { POST } = await import('./start/+server');
    const res = await POST({ request: post('/api/agent-chat/start', { agentId: 'synthetic' }), locals: { token: 't' } } as never);
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: message, code: portalCode });
    for (const s of SENTINELS) expect(text).not.toContain(s);
    for (const s of SENTINELS) expect(loggedText(spies)).not.toContain(s);
    // Main now resolves the chat AI (its own read) before startChat; the pin is that the
    // refused startChat is sent exactly once (no retry), whatever else is read first.
    expect(request.mock.calls.filter(([q]) => String(q).includes('startChat'))).toHaveLength(1);
    // portal#1696: nothing is read after the refusal. The refused startChat is the LAST request,
    // whatever else was read before it (an unrelated total would couple this to the chat-AI read).
    expect(String(request.mock.calls.at(-1)![0])).toContain('startChat');
    expect(runChatTurn).not.toHaveBeenCalled();
  });

  it('turn: a sendChatMessage refusal is a fixed 409 {error, code}, no retry, nothing leaked', async () => {
    const spies = consoleSpies();
    runChatTurn.mockRejectedValue(refusal(serverCode));
    const { POST } = await import('./turn/+server');
    const res = await POST({ request: post('/api/agent-chat/turn', { agentId: 'a', chatId: 'c', userMessage: 'hi' }), locals: { token: 't' } } as never);
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: message, code: portalCode });
    for (const s of SENTINELS) expect(text).not.toContain(s);
    for (const s of SENTINELS) expect(loggedText(spies)).not.toContain(s);
    expect(runChatTurn).toHaveBeenCalledTimes(1);
  });
});

describe('everything else is unchanged', () => {
  it('start: an unknown GraphQL code keeps the generic failure (500)', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: SENTINELS[0], extensions: { code: 'SOMETHING_NEW' } }] } });
    const { POST } = await import('./start/+server');
    const res = await POST({ request: post('/api/agent-chat/start', { agentId: 'synthetic' }), locals: { token: 't' } } as never);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe('Chat request failed. Please try again.');
    expect(text).not.toContain(SENTINELS[0]);
  });

  it('turn: an unknown code and an internal error keep the generic failure (500)', async () => {
    const { POST } = await import('./turn/+server');
    for (const code of ['SOMETHING_NEW', 'INTERNAL_SERVER_ERROR']) {
      runChatTurn.mockRejectedValue({ response: { errors: [{ message: SENTINELS[0], extensions: { code } }] } });
      const res = await POST({ request: post('/api/agent-chat/turn', { agentId: 'a', chatId: 'c', userMessage: 'hi' }), locals: { token: 't' } } as never);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
    }
  });

  it('turn: the no-LLM-config 409 is untouched', async () => {
    const { ChatError } = await import('$lib/server/llm/chatError');
    runChatTurn.mockRejectedValue(new ChatError('noConfig'));
    const { POST } = await import('./turn/+server');
    const res = await POST({ request: post('/api/agent-chat/turn', { agentId: 'a', chatId: 'c', userMessage: 'hi' }), locals: { token: 't' } } as never);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('noConfig');
  });
});

describe('keyed on the code alone (Rook P3-3)', () => {
  it('an unknown code whose message reads like a boot-prompt refusal stays the generic failure', async () => {
    const { publicChatError } = await import('$lib/server/llm/chatError');
    const err = { response: { errors: [{ message: 'BOOT_PROMPT_NOT_SET: no boot prompt set', extensions: { code: 'SOMETHING_ELSE' } }] } };
    expect(publicChatError(err)).toMatchObject({ code: 'failed', status: 500 });
  });
});
