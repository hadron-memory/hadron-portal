import { describe, it, expect } from 'vitest';
import { chooseAppChatTabRender } from './app-chat-tab.js';

describe('chooseAppChatTabRender — spec 016 US4', () => {
  it("returns 'agent-chat' when chat surface is on and an agent is linked", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: 'agent-1' })).toBe('agent-chat');
    expect(chooseAppChatTabRender({ surfaces: ['mcp', 'chat'], agentId: 'agent-1' })).toBe('agent-chat');
  });

  it("returns 'empty-no-agent' when chat surface is on but no agent is linked", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: null })).toBe('empty-no-agent');
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: undefined })).toBe('empty-no-agent');
  });

  it("returns 'hidden' when chat surface is off, regardless of agentId", () => {
    expect(chooseAppChatTabRender({ surfaces: ['mcp'], agentId: 'agent-1' })).toBe('hidden');
    expect(chooseAppChatTabRender({ surfaces: [], agentId: null })).toBe('hidden');
    expect(chooseAppChatTabRender({ surfaces: null, agentId: 'agent-1' })).toBe('hidden');
    expect(chooseAppChatTabRender({ surfaces: undefined, agentId: null })).toBe('hidden');
  });

  it("does not treat 'chatter' or other near-misses as the chat surface", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chatter'], agentId: 'a' })).toBe('hidden');
    expect(chooseAppChatTabRender({ surfaces: ['chats'], agentId: 'a' })).toBe('hidden');
  });
});
