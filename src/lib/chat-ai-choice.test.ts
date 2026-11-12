/**
 * portal#1963: which AI config a chat runs with, as the chatbot dropdown sees it
 * (hadron-server#3957, hrn:node:hadronmemory.com:specs:cor:dmo:050:10).
 *
 * The server's list holds the App's OWN enabled configs plus one `default`
 * entry. A new chat preselects the App's chatbot config; a reopened chat shows
 * the choice stored with it. A stored choice that is no longer in the list (a
 * deleted or disabled config) is skipped by the server, so the dropdown falls
 * back the same way: the App's chatbot config, else `default`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAT_AI_CHOICE,
  chatAiChoiceLabel,
  initialChatAiChoice,
  liveChatAiChoices,
  type ChatAiChoiceOption,
} from './chat-ai-choice';

const opt = (o: Partial<ChatAiChoiceOption> & { value: string; name: string }): ChatAiChoiceOption => ({
  provider: 'anthropic',
  model: 'claude-x',
  isDefault: false,
  isAppChatbotConfig: false,
  unavailableReason: null,
  ...o,
});

const DEFAULT = opt({ value: 'default', name: 'default', provider: null, model: null, isDefault: true });
const FAST = opt({ value: 'cfg-fast', name: 'fast', model: 'haiku' });
const SMART = opt({ value: 'cfg-smart', name: 'smart', model: 'opus', isAppChatbotConfig: true });

describe('initialChatAiChoice', () => {
  it('a new chat preselects the App chatbot config', () => {
    expect(initialChatAiChoice([DEFAULT, FAST, SMART], null)).toBe('cfg-smart');
  });

  it('a new chat with no App chatbot config preselects default', () => {
    expect(initialChatAiChoice([DEFAULT, FAST], null)).toBe(DEFAULT_CHAT_AI_CHOICE);
    expect(initialChatAiChoice([DEFAULT, FAST], undefined)).toBe('default');
  });

  it('a reopened chat shows the choice stored with it', () => {
    expect(initialChatAiChoice([DEFAULT, FAST, SMART], 'cfg-fast')).toBe('cfg-fast');
    expect(initialChatAiChoice([DEFAULT, FAST, SMART], 'default')).toBe('default');
  });

  it('a stored choice the list no longer has falls back as the server does', () => {
    expect(initialChatAiChoice([DEFAULT, FAST, SMART], 'cfg-deleted')).toBe('cfg-smart');
    expect(initialChatAiChoice([DEFAULT, FAST], 'cfg-deleted')).toBe('default');
  });

  it('a stored choice the portal cannot run is still shown, not swapped silently', () => {
    const custom = opt({ value: 'cfg-custom', name: 'custom', unavailableReason: 'x' });
    expect(initialChatAiChoice([DEFAULT, custom], 'cfg-custom')).toBe('cfg-custom');
  });

  // portal#1997: an un-picked turn runs the App chatbot config whether or not the portal can run it, so the
  // dropdown shows that config (its label carries the reason) rather than a Default that never runs.
  it('an App chatbot config the portal cannot run is still shown for a new chat, as the turn will run it', () => {
    const custom = opt({ value: 'cfg-custom', name: 'custom', isAppChatbotConfig: true, unavailableReason: 'x' });
    expect(initialChatAiChoice([DEFAULT, custom], null)).toBe('cfg-custom');
    expect(initialChatAiChoice([DEFAULT, custom], 'cfg-deleted')).toBe('cfg-custom');
  });
});

describe('chatAiChoiceLabel', () => {
  it('names a config with its provider and model', () => {
    expect(chatAiChoiceLabel(FAST)).toBe('fast (anthropic · haiku)');
  });

  it('marks the App chatbot config', () => {
    expect(chatAiChoiceLabel(SMART)).toBe('smart (anthropic · opus) · App chatbot config');
  });

  it('renders default as the marker entry, never a model', () => {
    expect(chatAiChoiceLabel(DEFAULT)).toBe('Default');
  });

  it('says why a config cannot run here', () => {
    const custom = opt({ value: 'cfg-custom', name: 'custom', model: 'k2', unavailableReason: "can't run in portal chats yet" });
    expect(chatAiChoiceLabel(custom)).toBe("custom (anthropic · k2) · can't run in portal chats yet");
  });
});

describe('liveChatAiChoices', () => {
  const all = [DEFAULT, FAST, SMART];

  const ANTHROPIC = 'https://api.anthropic.com/v1';
  const live = (id: string, over: Record<string, unknown> = {}) => ({
    id, provider: 'anthropic', effectiveEndpoint: ANTHROPIC, hasApiKey: true, enabled: true, ...over,
  });

  it('drops an entry the live read no longer has, or has disabled', () => {
    const smartLive = live('cfg-smart', { name: 'smart', model: 'opus' });
    expect(liveChatAiChoices(all, [smartLive], false)).toEqual([DEFAULT, SMART]);
    expect(liveChatAiChoices(all, [live('cfg-fast', { enabled: false }), smartLive], false)).toEqual([DEFAULT, SMART]);
  });

  it('recomputes the runtime label from the live read, both ways (BLIND F3)', () => {
    const noKey = opt({ value: 'cfg-fast', name: 'fast', model: 'haiku', unavailableReason: 'no key available here' });
    // A key added on the AI tab enables the entry without a reload...
    expect(liveChatAiChoices([DEFAULT, noKey], [live('cfg-fast', { name: 'fast', model: 'haiku' })], false)![1].unavailableReason).toBeNull();
    // ...and a key removed, or a custom endpoint set, disables it.
    expect(liveChatAiChoices([DEFAULT, FAST], [live('cfg-fast', { hasApiKey: false })], false)![1].unavailableReason).toBe('no key available here');
    expect(liveChatAiChoices([DEFAULT, FAST], [live('cfg-fast', { effectiveEndpoint: 'https://proxy.example/v1' })], false)![1].unavailableReason)
      .toBe("can't run in portal chats yet");
  });

  it('takes the live name, provider and model', () => {
    const [, fast] = liveChatAiChoices([DEFAULT, FAST], [live('cfg-fast', { name: 'quick', model: 'sonnet' })], false)!;
    expect(fast).toMatchObject({ value: 'cfg-fast', name: 'quick', provider: 'anthropic', model: 'sonnet' });
  });

  it('keeps only default when a refresh failed, and the whole list when the loader could not read', () => {
    expect(liveChatAiChoices(all, null, true)).toEqual([DEFAULT]);
    expect(liveChatAiChoices(all, null, false)).toEqual(all);
  });

  it('passes a missing list through as missing', () => {
    expect(liveChatAiChoices(null, [], false)).toBeNull();
  });
});
