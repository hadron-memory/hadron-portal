import { afterEach, expect, it } from 'vitest';
import { mountAgentChat, type AgentChatFixture } from './agent-chat-phone-harness';

const originalFetch = window.fetch;
let fixture: AgentChatFixture | undefined;
let target: HTMLDivElement | undefined;
afterEach(async () => {
  await fixture?.stop();
  fixture = undefined;
  target?.remove();
  target = undefined;
  window.fetch = originalFetch;
  history.replaceState(null, '', '/');
});

it('the short-title fixture changes B by identity and leaves A and the next mount unchanged', async () => {
  target = document.body.appendChild(document.createElement('div'));
  fixture = mountAgentChat(target, { rowActions: true, shortTitle: true });
  const list = async () => (await (await fetch('/api/agent-chat/list')).json()).chats as Array<{loc: string; title: string}>;
  const short = await list();
  expect(short.find(c => c.loc === 'chats:b')?.title).toBe('Hi');
  expect(short.find(c => c.loc === 'chats:a')?.title).toBe('Planning the spring onboarding for the regional volunteer teams');
  await fixture.stop();
  fixture = mountAgentChat(target, { rowActions: true });
  const ordinary = await list();
  expect(ordinary.find(c => c.loc === 'chats:b')?.title).toBe('Second chat');
  expect(ordinary.find(c => c.loc === 'chats:a')?.title).toBe(short.find(c => c.loc === 'chats:a')?.title);
});
