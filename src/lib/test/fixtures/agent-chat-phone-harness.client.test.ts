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

// portal#2165 item 1: holdDelete's gate. Each pin drives real held requests and
// reads their state through a bounded wait, so a broken gate fails the pin
// instead of hanging it.
const del = (chatId: string) =>
  fetch('/api/agent-chat/delete', { method: 'POST', body: JSON.stringify({ chatId }) });
const state = (p: Promise<unknown>, ms = 40) =>
  Promise.race([p.then(() => 'settled' as const), new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms))]);
const mountRows = () => {
  target = document.body.appendChild(document.createElement('div'));
  fixture = mountAgentChat(target, { rowActions: true });
  return fixture;
};

it('repeated holdDelete shares the active gate', async () => {
  const f = mountRows();
  const release = f.holdDelete();
  const first = del('chats:a');
  const again = f.holdDelete();
  const second = del('chats:b');
  expect(await state(first)).toBe('pending');
  expect(await state(second)).toBe('pending');
  release();
  // One release settles every request waiting on the shared gate, once.
  expect(await state(first)).toBe('settled');
  expect(await state(second)).toBe('settled');
  expect(f.calls.delete).toBe(2);
  again();
});

it('release is idempotent', async () => {
  const f = mountRows();
  const release = f.holdDelete();
  const waiting = del('chats:a');
  expect(await state(waiting)).toBe('pending');
  release();
  release();
  expect(await state(waiting)).toBe('settled');
  expect(f.calls.delete).toBe(1);
});

it('a stale release cannot clear a newer hold', async () => {
  const f = mountRows();
  const old = f.holdDelete();
  old();
  const newer = f.holdDelete();
  const held = del('chats:a');
  old();
  // The old release is spent: it neither resolves the newer hold's waiter nor
  // lets a request started after it through.
  expect(await state(held)).toBe('pending');
  const later = del('chats:b');
  expect(await state(later)).toBe('pending');
  newer();
  expect(await state(held)).toBe('settled');
  expect(await state(later)).toBe('settled');
});
