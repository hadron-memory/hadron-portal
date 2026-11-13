// portal#2088: the real AgentChat with the compiled stylesheet in real Chromium.
// The chat API is answered here with synthetic data; no server, provider or
// signed-in route is involved. The runner swaps `$app/navigation` for the
// recorder, so `navigationCalls` shows every URL sync the component makes.
import { mount, unmount } from 'svelte';
import AgentChat from '$lib/components/AgentChat.svelte';
import { navigationCalls } from '$lib/test/stubs/app-navigation';

export const LONG_TOKEN = 'unbroken'.repeat(24);
const CHATS = [
  {
    id: 'chat-a',
    loc: 'chats:a',
    title: 'Planning the spring onboarding for the regional volunteer teams',
    conversationName: 'Volunteer onboarding conversation',
    stageName: 'Collecting availability and preferred locations',
    messageCount: 3,
    createdAt: '2026-11-01T00:00:00Z',
    lastMessageAt: '2026-11-01T00:05:00Z',
    scope: 'private',
    createdBy: 'user-fixture',
    aiConfigChoice: null,
  },
  {
    id: 'chat-b',
    loc: 'chats:b',
    title: 'Second chat',
    conversationName: null,
    stageName: null,
    messageCount: 1,
    createdAt: '2026-11-01T00:00:00Z',
    lastMessageAt: null,
    scope: 'shared',
    createdBy: 'user-fixture',
    aiConfigChoice: null,
  },
];
const MESSAGES = [
  { role: 'assistant', content: 'Welcome! Which weeks work best for your team this spring?', seq: 1, createdAt: '2026-11-01T00:00:00Z' },
  { role: 'user', content: `Here is the reference you asked for: ${LONG_TOKEN}`, seq: 2, createdAt: '2026-11-01T00:01:00Z' },
  { role: 'assistant', content: `Thanks. I noted ${LONG_TOKEN} and will use it for the schedule.`, seq: 3, createdAt: '2026-11-01T00:02:00Z' },
];
export const START_REFUSAL =
  'This chat could not be started because the App has no AI configuration that this agent may use right now. Ask an App manager to add one, then try again.';

export type AgentChatFixture = {
  stop: () => void;
  calls: Record<string, number>;
  navigationCalls: typeof navigationCalls;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function mountAgentChat(target: HTMLElement, options: { refuseStart?: boolean } = {}): AgentChatFixture {
  navigationCalls.length = 0;
  // The recorder only records. SvelteKit's replaceState also changes the
  // address, and AgentChat reads `window.location` live before each sync, so
  // apply recorded replaceState calls to the real history as Kit would.
  const record = navigationCalls.push.bind(navigationCalls);
  navigationCalls.push = (...entries) => {
    for (const entry of entries)
      if (entry.fn === 'replaceState') history.replaceState(history.state, '', String(entry.args[0]));
    return record(...entries);
  };
  const calls: Record<string, number> = { list: 0, resume: 0, start: 0, writes: 0 };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/agent-chat/list')) {
      calls.list++;
      return json({ chats: CHATS });
    }
    if (url.includes('/api/agent-chat/resume')) {
      calls.resume++;
      const { chatId } = JSON.parse(String(init?.body ?? '{}'));
      const chat = CHATS.find((c) => c.loc === chatId);
      if (!chat) return json({ error: 'Chat not found' }, 404);
      return json({ chat, messages: MESSAGES, hasOlder: false });
    }
    if (url.includes('/api/agent-chat/start')) {
      calls.start++;
      if (options.refuseStart) return json({ error: START_REFUSAL }, 400);
      return json({ chatId: 'chats:a', conversationName: CHATS[0].conversationName, stageName: CHATS[0].stageName, scope: 'private', welcomeMessage: 'Welcome back.' });
    }
    // The served-prompt strip reads its records for the open chat: none here.
    if (url.includes('/api/served-prompts')) return json({ items: [], total: 0, offset: 0 });
    // Reads the fixture does not model answer 404. Writes
    // (rename, delete, turn) should never happen here: Back is view
    // navigation and must send nothing, so every non-GET is counted.
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') calls.writes++;
    return json({ error: 'not in fixture' }, 404);
  };
  const component = mount(AgentChat, {
    target,
    props: {
      agentId: 'agent-fixture',
      appId: 'app-fixture',
      uploadMemoryId: 'memory-fixture',
      aiChoices: [
        { value: 'default', name: 'Default', provider: 'synthetic', model: 'fixture-model', isDefault: true, unavailableReason: null },
      ] as never,
    },
  });
  return { stop: () => unmount(component), calls, navigationCalls };
}
