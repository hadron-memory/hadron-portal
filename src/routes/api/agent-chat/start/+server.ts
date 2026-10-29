import { gqlClient } from '$lib/server/api';
import { classifyGqlError, extractGqlError, gqlErrorTextForBranching } from '$lib/server/gqlError';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { runChatTurn } from '$lib/server/llm/agentChatTurn.js';
import { publicChatError } from '$lib/server/llm/chatError.js';
import { t } from '$lib/i18n/t';
import type { HadronTool } from '$lib/server/llm/agentChatLlm.js';
import type { RequestHandler } from './$types';

/** Extract the typed error code that hadron-server's `ChatScopeError`
 *  exposes via `GraphQLError.extensions.code`. Returns null when the
 *  thrown value isn't shaped like a graphql-request error or has no
 *  extensions.code (e.g. legacy non-GraphQLError throws). */
function getGqlErrorCode(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const errs = (
    e as {
      response?: { errors?: Array<{ extensions?: { code?: string } }> };
    }
  ).response?.errors;
  return errs?.[0]?.extensions?.code ?? null;
}

/**
 * POST /api/agent-chat/start
 * Body: { agentId: string, conversationName?: string, scope?: 'private' | 'shared' }
 *
 * Spec 017: scope defaults to 'private' (FR-003). A 'shared' request requires
 * a resolvable App context server-side; if none, the server throws
 * SHARED_CHAT_REQUIRES_APP_CONTEXT which this handler surfaces to the portal
 * as a structured 400 body.
 *
 * Creates a new chat node in the matching memory (personal for private,
 * app-class for shared), then runs one "welcome" LLM turn so the agent
 * greets the user before they type anything. Returns the chatId, the
 * welcome message, and the initial conversation/stage so the UI can
 * render immediately.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    agentId?: string;
    conversationName?: string;
    scope?: 'private' | 'shared';
    appId?: string;
    configName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body.agentId) {
    return new Response(JSON.stringify({ error: 'agentId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Spec 017: scope defaults to 'private' per FR-003.
  const scope: 'private' | 'shared' = body.scope === 'shared' ? 'shared' : 'private';

  // Spec 016 — startChat and the welcome turn used to be coupled: a
  // failed welcome (missing AI config, agent with no conversations
  // configured, LLM error) would 500 the whole /start call AND leave
  // an orphan chat node in per-user memory. They are now separated:
  // startChat is the hard contract; the welcome turn is best-effort.
  // Reasoning: the chat exists once startChat returns a chatId — the
  // user can still type the first message themselves and chat begins
  // there. Welcome-turn failures surface as a soft `welcomeError`
  // hint, not a blocking error.

  // 1. Create the chat in Hadron — provisions the user memory and
  //    returns the compiled first-stage prompt + tool schema.
  let chatId: string;
  let systemMessage: string;
  let tools: HadronTool[] | null;
  let conversationName: string | null;
  let stageName: string | null;
  try {
    const startResult = await gqlClient(locals.token).request<{
      startChat: {
        chatId: string;
        systemMessage: string;
        tools: HadronTool[] | null;
        conversationName: string | null;
        stageName: string | null;
      };
    }>(START_CHAT_MUTATION, {
      agentId: body.agentId,
      conversationName: body.conversationName ?? null,
      scope,
    });
    chatId = startResult.startChat.chatId;
    systemMessage = startResult.startChat.systemMessage;
    tools = startResult.startChat.tools;
    conversationName = startResult.startChat.conversationName;
    stageName = startResult.startChat.stageName;
  } catch (e) {
    // Spec 017 FR-006 / SC-005 — distinguish ChatScopeError sub-codes so
    // the portal can render an actionable message per failure mode.
    //
    // Wire format: hadron-server's `ChatScopeError` extends `GraphQLError`
    // with `extensions: { code }`, so `extensions.code` is the primary
    // signal. The English `message.toLowerCase().includes(...)` checks
    // below are a defense-in-depth fallback for environments where the
    // server hasn't yet shipped the `extends GraphQLError` change — they
    // can be removed once the deploy is confirmed.
    const code = getGqlErrorCode(e);
    if (
      code === 'SHARED_CHAT_REQUIRES_APP_CONTEXT' ||
      gqlErrorTextForBranching(e).toLowerCase().includes('not a member of any app')
    ) {
      return new Response(
        JSON.stringify({
          error: 'shared-chat-requires-app-context',
          message: t('agent-chat.error.shared-chat-membership', 'A shared chat requires membership in an App that installs this Agent.'),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (
      code === 'SHARED_CHAT_NOT_AVAILABLE_FOR_APP_SESSIONS' ||
      gqlErrorTextForBranching(e).toLowerCase().includes('not available for mcp app-key sessions')
    ) {
      // Practically unreachable via the portal (/api/agent-chat/start is
      // JWT-only), but kept so MCP-App-key callers via this endpoint get
      // a typed response instead of a 500.
      return new Response(
        JSON.stringify({
          error: 'shared-chat-not-available-for-app-sessions',
          message: t('agent-chat.error.shared-chat-app-session', 'Shared chats are unavailable for App sessions.'),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: classifyGqlError(e).kind === 'internal' ? extractGqlError(e, '') : publicChatError(e).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Welcome turn — best-effort. The LLM gets the compiled stage
  //    prompt as the system message with no user history. On failure
  //    the chat is still created and usable; the user types the first
  //    message themselves.
  let welcomeMessage: string | null = null;
  let welcomeError: string | null = null;
  let finalStageName = stageName;
  let stageTransitioned = false;
  try {
    const turn = await runChatTurn({
      token: locals.token,
      agentId: body.agentId,
      chatId,
      userMessage: null,
      appId: body.appId,
      configName: body.configName,
      startPayload: { systemMessage, tools },
    });
    welcomeMessage = turn.assistantMessage;
    finalStageName = turn.newStageName ?? stageName;
    stageTransitioned = turn.stageTransitioned;
  } catch (e) {
    const safe = publicChatError(e);
    welcomeError = safe.message;
    console.warn('[agent-chat/start] welcome turn failed (chat is created and usable):', safe.code);
  }

  return new Response(
    JSON.stringify({
      chatId,
      conversationName,
      stageName: finalStageName,
      welcomeMessage,
      welcomeError,
      stageTransitioned,
      scope,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
