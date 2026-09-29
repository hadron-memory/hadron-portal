import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAgentChatLlm } from './agentChatLlm.js';
import { CHAT_ERROR, publicChatError } from './chatError.js';

afterEach(() => vi.unstubAllGlobals());

describe('provider error containment', () => {
  it('drops a synthetic bearer echoed by a fake provider through the real SDK', async () => {
    const sentinel = 'sk-synthetic-966-never-a-real-key';
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization');
      expect(authorization).toBe(`Bearer ${sentinel}`);
      return Response.json({ error: { message: `401 ${authorization}`, type: 'invalid_request_error' } }, { status: 401 });
    });
    vi.stubGlobal('fetch', fetcher);

    let caught: unknown;
    try {
      await callAgentChatLlm({
        provider: 'openai', apiKey: sentinel, model: 'gpt-4o',
        systemMessage: 'Hello', tools: null, messages: [],
      });
    } catch (e) {
      caught = e;
    }

    expect(fetcher).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(Error);
    expect(publicChatError(caught)).toEqual({
      code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500,
    });
    expect(JSON.stringify(caught)).not.toContain(sentinel);
    expect(String(caught)).not.toContain(sentinel);
  });

  it('does not promote an arbitrary error message to a public response', () => {
    expect(publicChatError(new Error('Authorization: Bearer sk-synthetic-966'))).toEqual({
      code: 'failed', message: CHAT_ERROR.failed, status: 500,
    });
  });
});
