/**
 * portal#1963: the App's chatbot AI config setting (hadron-server#3957,
 * setAppChatbotAiConfig, hrn:node:hadronmemory.com:specs:cor:dmo:050:10 and :12).
 *
 * Whoever manages the App picks one of the App's own configs, or clears it. The
 * action sends the picked id, or null to clear, and nothing else. The server's
 * gate decides who may; a refusal is one fixed message per kind, never the
 * server's text, and never success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_APP_CHATBOT_AI_CONFIG_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn() }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

import { actions } from './+page.server';

beforeEach(() => {
  mockRequest.mockReset();
});

type Result = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;
async function run(fields: Record<string, string>): Promise<Result> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (await actions.setChatbotAiConfig({
    request: { formData: async () => fd },
    params: { appId: 'app-1' },
    locals: { token: 'tok' },
  } as never)) as Result;
}
const refusal = (code: string, message = 'server prose that must not reach the user') =>
  Object.assign(new Error(message), { response: { errors: [{ message, extensions: { code } }] } });
const sent = () => mockRequest.mock.calls[0] as [string, Record<string, unknown>];

describe('setChatbotAiConfig (#1963)', () => {
  it('sets the picked config by id', async () => {
    mockRequest.mockResolvedValueOnce({ setAppChatbotAiConfig: { id: 'app-1', chatbotAiConfigId: 'cfg-1' } });
    const r = await run({ configId: 'cfg-1' });
    const [doc, vars] = sent();
    expect(doc).toBe(SET_APP_CHATBOT_AI_CONFIG_MUTATION);
    expect(vars).toEqual({ appRef: 'app-1', configId: 'cfg-1' });
    expect(r.chatbotAiConfig).toEqual({ ok: true, configId: 'cfg-1' });
  });

  it('clears it with null, never an empty string', async () => {
    mockRequest.mockResolvedValueOnce({ setAppChatbotAiConfig: { id: 'app-1', chatbotAiConfigId: null } });
    const r = await run({ configId: '' });
    expect(sent()[1]).toEqual({ appRef: 'app-1', configId: null });
    expect(r.chatbotAiConfig).toEqual({ ok: true, configId: null });
  });

  it('a config that is not one of the App\'s gets one fixed message', async () => {
    mockRequest.mockRejectedValueOnce(refusal('AiServiceConfigNotFoundError'));
    const r = await run({ configId: 'cfg-other' });
    expect(r.status).toBe(409);
    const text = JSON.stringify(r.data);
    expect(text).not.toContain('server prose');
    expect(text).toContain("isn't one of this App's AI configs");
  });

  it('a caller who may not manage the App gets one fixed message', async () => {
    mockRequest.mockRejectedValueOnce(refusal('FORBIDDEN'));
    const r = await run({ configId: 'cfg-1' });
    expect(r.status).toBe(403);
    const text = JSON.stringify(r.data);
    expect(text).not.toContain('server prose');
    expect(text).toContain('Only whoever manages this App');
  });

  it('any other failure is a failure, never success', async () => {
    mockRequest.mockRejectedValueOnce(new Error('socket hang up'));
    const r = await run({ configId: 'cfg-1' });
    expect(r.status).toBe(500);
    expect(r.data?.chatbotAiConfig).toMatchObject({ ok: false });
  });
});
