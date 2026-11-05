/**
 * portal#916 — the turn route's answer to a chat turn whose extraction the authoring gate refused after the server
 * had already saved the reply (hadron-server#3514). Only a recognised structured partialTurn marker earns the
 * fixed saved-reply copy, the 409 and the partialTurn flag; the code alone, or a malformed marker, is today's
 * generic `failed` 500 and never claims the reply was saved. Nothing from the server's message or extensions
 * (task, revision, role, rule) reaches the reader or the log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runChatTurn = vi.fn();
vi.mock('$lib/server/llm/agentChatTurn.js', () => ({ runChatTurn: (...a: unknown[]) => runChatTurn(...a) }));

const SENTINELS = ['sentinel-task-01HZZ', 'sentinel-rule-role', 'sentinel-rev-99', '<script>sentinel</script>', 'sentinel-resolver-prose'];
const GENERIC = 'Chat request failed. Please try again.';

const CASES = [
  ['AUTHORING_ATTESTATION_MISSING', 'partialTurnAttestationMissing', "Your message was sent and the reply was saved, but the chat couldn't save the information it collected: this memory accepts that data only from a task-assigned author, and a chat turn doesn't name one. Ask whoever manages the memory."],
  ['AUTHOR_TASK_BROKEN', 'partialTurnAuthorTaskBroken', "Your message was sent and the reply was saved, but the information it collected wasn't: the task this memory requires for that data is unavailable. It stays that way until whoever manages the memory repairs it."],
] as const;

const marker = (code: string) => ({
  persisted: ['ASSISTANT_MESSAGE', 'MESSAGE_COUNTER'],
  refused: [{ component: 'EXTRACTION', code }],
  notRun: ['STAGE_PROGRESSION'],
});
function refusal(code: string, partialTurn?: unknown) {
  return {
    response: {
      errors: [
        {
          message: `refused ${SENTINELS[4]} ${SENTINELS[3]}`,
          extensions: { code, taskId: SENTINELS[0], ruleRole: SENTINELS[1], revision: SENTINELS[2], ...(partialTurn === undefined ? {} : { partialTurn }) },
        },
      ],
    },
  };
}
const post = (body: unknown) =>
  new Request('http://localhost/api/agent-chat/turn', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const consoleSpies = () =>
  (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
const loggedText = (spies: ReturnType<typeof consoleSpies>) => JSON.stringify(spies.flatMap((s) => s.mock.calls));
async function turn() {
  const { POST } = await import('./turn/+server');
  const res = await POST({ request: post({ agentId: 'a', chatId: 'c', userMessage: 'hi' }), locals: { token: 't' } } as never);
  return { res, text: await res.text() };
}

beforeEach(() => { runChatTurn.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe.each(CASES)('%s', (serverCode, portalCode, message) => {
  it('recognised marker: fixed message, 409 and the partialTurn flag, no retry, nothing leaked', async () => {
    const spies = consoleSpies();
    runChatTurn.mockRejectedValue(refusal(serverCode, marker(serverCode)));
    const { res, text } = await turn();
    expect(res.status).toBe(409);
    expect(JSON.parse(text)).toEqual({ error: message, code: portalCode, partialTurn: true });
    for (const s of SENTINELS) expect(text).not.toContain(s);
    for (const s of SENTINELS) expect(loggedText(spies)).not.toContain(s);
    expect(runChatTurn).toHaveBeenCalledTimes(1);
  });

  it('the code with no marker is today\'s generic failed 500 and never says the reply was saved', async () => {
    runChatTurn.mockRejectedValue(refusal(serverCode));
    const { res, text } = await turn();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: GENERIC, code: 'failed' });
    expect(text).not.toContain('saved');
  });

  it.each([
    ['missing ASSISTANT_MESSAGE', (c: string) => ({ ...marker(c), persisted: ['MESSAGE_COUNTER'] })],
    ['missing STAGE_PROGRESSION', (c: string) => ({ ...marker(c), notRun: [] })],
    ['mismatched refused code', () => marker('SOMETHING_ELSE')],
    ['wrong types', () => ({ persisted: 'ASSISTANT_MESSAGE', refused: 'x', notRun: 5 })],
  ])('malformed marker (%s) is today\'s generic failed 500, no flag', async (_n, make) => {
    runChatTurn.mockRejectedValue(refusal(serverCode, make(serverCode)));
    const { res, text } = await turn();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: GENERIC, code: 'failed' });
  });
});

describe('everything else is unchanged', () => {
  it.each(['AUTHORING_ATTESTATION_WRONG_TASK', 'AUTHORING_ATTESTATION_STALE', 'SOMETHING_NEW'])('%s with a marker naming it stays generic', async (code) => {
    runChatTurn.mockRejectedValue(refusal(code, marker(code)));
    const { res, text } = await turn();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: GENERIC, code: 'failed' });
  });

  it('a success keeps its body', async () => {
    runChatTurn.mockResolvedValue({ assistantMessage: 'ok' });
    const { res, text } = await turn();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ assistantMessage: 'ok' });
  });
});
