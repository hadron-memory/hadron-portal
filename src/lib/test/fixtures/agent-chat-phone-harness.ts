// portal#2088: the real AgentChat with the compiled stylesheet in real Chromium.
// The chat API is answered here with synthetic data; no server, provider or
// signed-in route is involved. The runner swaps `$app/navigation` for the
// recorder, so `navigationCalls` shows every URL sync the component makes.
import { mount, unmount } from 'svelte';
import AgentChat from '$lib/components/AgentChat.svelte';
import { navigationCalls } from '$lib/test/stubs/app-navigation';

export const LONG_TOKEN = 'unbroken'.repeat(24);
/** portal#2215: an AI config name far wider than a phone, to stress the composer row. */
export const LONG_CONFIG_NAME = 'Regional volunteer onboarding assistant with extended context and scheduling tools'.repeat(2);
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
  /** Hold the next delete answers until the returned function is called. */
  holdDelete: () => () => void;
  /**
   * Make the next delete fail (portal#2104), once: `network` rejects as a
   * dropped connection does, `json` answers 500 with `{error}`, `text` answers
   * 500 with a body that isn't JSON. The chat stays listed.
   */
  failDelete: (kind: DeleteFailure) => void;
  /** Make the next turn reject as a dropped connection does, once (#2110). */
  failTurn: () => void;
};

export type DeleteFailure = 'network' | 'json' | 'text';
export const DELETE_REFUSAL = 'Delete refused';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * `rowActions` (portal#2098) answers rename and delete from a per-mount copy
 * of the chats, so the row actions can be driven end to end; their calls are
 * counted as `title` and `delete`, never as `writes`.
 */
export function mountAgentChat(target: HTMLElement, options: { refuseStart?: boolean; rowActions?: boolean; shortTitle?: boolean; transcriptHeight?: boolean; longConfigName?: boolean } = {}): AgentChatFixture {
  const chats = (options.transcriptHeight ? CHATS.slice(0, 1) : CHATS).map((c) => ({ ...c }));
  const messages = options.transcriptHeight
    ? [{ role: 'user', content: 'Can we plan the next session?', seq: 1 },
       { role: 'assistant', content: 'Yes, let’s plan the next session.', seq: 2 }]
    : MESSAGES;
  if (options.shortTitle) {
    // Loc can change when a real node moves; this seeded fixture never moves
    // its chats, so loc is stable here even if the seed array is reordered.
    // The one-chat transcript-height seed has no chats:b; there shortTitle is a
    // no-op, as it was on main. Every other seed must hold it.
    const chat = chats.find(c => c.loc === 'chats:b');
    if (!chat && !options.transcriptHeight) throw new Error('short-title fixture requires chats:b');
    if (chat) chat.title = 'Hi';
  }
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
  const calls: Record<string, number> = { list: 0, resume: 0, start: 0, writes: 0, title: 0, delete: 0 };
  // A held delete answers only once released, so a test can act in between.
  let deleteGate: Promise<void> | null = null;
  const holdDelete = () => {
    let release = () => {};
    deleteGate = new Promise<void>((resolve) => (release = resolve));
    return () => {
      deleteGate = null;
      release();
    };
  };
  let deleteFailure: DeleteFailure | null = null;
  const failDelete = (kind: DeleteFailure) => {
    deleteFailure = kind;
  };
  let turnFailure = false;
  const failTurn = () => {
    turnFailure = true;
  };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/agent-chat/list')) {
      calls.list++;
      return json({ chats });
    }
    if (url.includes('/api/agent-chat/resume')) {
      calls.resume++;
      const { chatId } = JSON.parse(String(init?.body ?? '{}'));
      const chat = chats.find((c) => c.loc === chatId);
      if (!chat) return json({ error: 'Chat not found' }, 404);
      return json({ chat, messages, hasOlder: false });
    }
    if (url.includes('/api/agent-chat/start')) {
      calls.start++;
      if (options.refuseStart) return json({ error: START_REFUSAL }, 400);
      return json({ chatId: 'chats:a', conversationName: CHATS[0].conversationName, stageName: CHATS[0].stageName, scope: 'private', welcomeMessage: 'Welcome back.' });
    }
    if (options.rowActions && url.includes('/api/agent-chat/title')) {
      calls.title++;
      const { chatId, title } = JSON.parse(String(init?.body ?? '{}'));
      const chat = chats.find((c) => c.loc === chatId);
      if (!chat) return json({ error: 'Chat not found' }, 404);
      chat.title = title;
      return json({ ok: true });
    }
    if (options.rowActions && url.includes('/api/agent-chat/delete')) {
      calls.delete++;
      if (deleteGate) await deleteGate;
      const failure = deleteFailure;
      deleteFailure = null;
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'json') return json({ error: DELETE_REFUSAL }, 500);
      if (failure === 'text') return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
      const { chatId } = JSON.parse(String(init?.body ?? '{}'));
      const at = chats.findIndex((c) => c.loc === chatId);
      if (at < 0) return json({ error: 'Chat not found' }, 404);
      chats.splice(at, 1);
      return json({ ok: true });
    }
    // Turns are not modelled; only a failed one is (#2110).
    if (turnFailure && url.includes('/api/agent-chat/turn')) {
      turnFailure = false;
      calls.writes++;
      throw new TypeError('Failed to fetch');
    }
    // The served-prompt strip reads its records for the open chat: none here.
    if (url.includes('/api/served-prompts')) return json({ items: [], total: 0, offset: 0 });
    // Reads the fixture does not model answer 404. Writes
    // (rename, delete, turn) should never happen here: Back is view
    // navigation and must send nothing, so every non-GET is counted.
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') calls.writes++;
    // Say so (portal#2104): the answer never reaches the network, so without
    // this a call the fixture doesn't model passes every oracle unnoticed.
    console.error(`agent-chat fixture: unmodelled ${init?.method ?? 'GET'} ${url}`);
    return json({ error: 'not in fixture' }, 404);
  };
  const component = mount(AgentChat, {
    target,
    props: {
      agentId: 'agent-fixture',
      appId: 'app-fixture',
      uploadMemoryId: 'memory-fixture',
      aiChoices: [
        { value: 'default', name: options.longConfigName ? LONG_CONFIG_NAME : 'Default', provider: 'synthetic', model: 'fixture-model', isDefault: !options.longConfigName, unavailableReason: null },
      ] as never,
    },
  });
  return { stop: () => unmount(component), calls, navigationCalls, holdDelete, failDelete, failTurn };
}
