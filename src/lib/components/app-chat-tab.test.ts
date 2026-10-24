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

  // 036-ai-service-config: LLM-readiness gate.
  it("returns 'no-llm-config' when agent is linked but no usable config resolves", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: 'a', llmReady: false })).toBe('no-llm-config');
  });

  it("treats unknown readiness (null/undefined) as 'do not block' → agent-chat", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: 'a', llmReady: true })).toBe('agent-chat');
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: 'a', llmReady: null })).toBe('agent-chat');
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: 'a' })).toBe('agent-chat');
  });

  it("prioritizes no-agent over readiness, and chat-surface-off over both", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: null, llmReady: false })).toBe('empty-no-agent');
    expect(chooseAppChatTabRender({ surfaces: ['mcp'], agentId: 'a', llmReady: false })).toBe('hidden');
  });
});

// portal#1148 (hadron-server#2089): the no-agent decision comes from the nullable COLLECTION.
describe('chooseAppChatTabRender — withheld agents', () => {
  it("null agents + null agentId is 'withheld', never 'empty-no-agent'", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: null, agents: null })).toBe('withheld');
  });
  it("known-empty control: agents [] + null agentId stays 'empty-no-agent'", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: null, agents: [] })).toBe('empty-no-agent');
  });
  it("a linked agent still renders chat, even if the roster is withheld", () => {
    expect(chooseAppChatTabRender({ surfaces: ['chat'], agentId: 'agent-1', agents: null })).toBe('agent-chat');
  });
  it("chat off stays 'hidden' regardless of the roster", () => {
    expect(chooseAppChatTabRender({ surfaces: [], agentId: null, agents: null })).toBe('hidden');
  });
});
