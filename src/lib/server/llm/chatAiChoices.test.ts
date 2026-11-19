/**
 * portal#1963: the dropdown's options are the server's list (hadron-server#3957),
 * each marked with whether the portal can run it. A config the portal can't call
 * yet (a custom endpoint until hadron-server#1418, a provider only the server
 * calls, or one with no key for this session) is kept and shown disabled with a
 * short reason, never hidden. Nothing about a key crosses into an option.
 */
import { describe, expect, it } from 'vitest';
import { chatAiChoiceOptions, type ChatAiChoiceRow, type ChatAiConfigRuntimeRow } from './chatAiChoices';

const choices: ChatAiChoiceRow[] = [
  { value: 'default', name: 'default', provider: null, model: null, isDefault: true, isAppChatbotConfig: false },
  { value: 'cfg-ok', name: 'ok', provider: 'anthropic', model: 'claude-x', isDefault: false, isAppChatbotConfig: true },
  { value: 'cfg-custom', name: 'custom', provider: 'openai', model: 'k2', isDefault: false, isAppChatbotConfig: false },
  { value: 'cfg-nokey', name: 'nokey', provider: 'anthropic', model: 'claude-y', isDefault: false, isAppChatbotConfig: false },
];

const configs: ChatAiConfigRuntimeRow[] = [
  { id: 'cfg-ok', provider: 'anthropic', effectiveEndpoint: 'https://api.anthropic.com/v1', hasApiKey: true, apiKeyPreview: 'sk-…abcd' },
  { id: 'cfg-custom', provider: 'openai', effectiveEndpoint: 'https://kimi.example.com/v1', hasApiKey: true, apiKeyPreview: 'sk-…wxyz' },
  { id: 'cfg-nokey', provider: 'anthropic', effectiveEndpoint: 'https://api.anthropic.com/v1', hasApiKey: false, apiKeyPreview: null },
];

describe('chatAiChoiceOptions', () => {
  it('keeps every entry of the server list, in its order', () => {
    expect(chatAiChoiceOptions(choices, configs).map((o) => o.value)).toEqual(['default', 'cfg-ok', 'cfg-custom', 'cfg-nokey']);
  });

  it('a config the portal can run has no reason', () => {
    const ok = chatAiChoiceOptions(choices, configs).find((o) => o.value === 'cfg-ok')!;
    expect(ok.unavailableReason).toBeNull();
    expect(ok.isAppChatbotConfig).toBe(true);
  });

  it('a custom endpoint is shown with a reason, not hidden', () => {
    const custom = chatAiChoiceOptions(choices, configs).find((o) => o.value === 'cfg-custom')!;
    expect(custom.unavailableReason).toBe("can't run in portal chats yet");
  });

  it('a config with no key for this session is shown with a reason', () => {
    const nokey = chatAiChoiceOptions(choices, configs).find((o) => o.value === 'cfg-nokey')!;
    expect(nokey.unavailableReason).toBe('no key available here');
  });

  it('default is always runnable from the list: it resolves through the walk at turn time', () => {
    expect(chatAiChoiceOptions(choices, configs)[0].unavailableReason).toBeNull();
  });

  it('with no config read to judge by, entries are offered as the server listed them', () => {
    expect(chatAiChoiceOptions(choices, null).every((o) => o.unavailableReason === null)).toBe(true);
  });

  it('carries no key material, whatever the config read holds', () => {
    const json = JSON.stringify(chatAiChoiceOptions(choices, configs));
    expect(json).not.toContain('sk-');
    expect(json).not.toContain('apiKey');
    expect(json).not.toContain('kimi.example.com');
  });
});
