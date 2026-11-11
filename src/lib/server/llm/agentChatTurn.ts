import { gqlClient } from '$lib/server/api';
import {
  SEND_CHAT_MESSAGE_MUTATION,
  PROCESS_CHAT_RESPONSE_MUTATION,
  SAVE_CHAT_SUMMARY_MUTATION,
} from '$lib/server/queries';
import { callAgentChatLlm, type HadronTool } from './agentChatLlm.js';
import { publicChatError } from './chatError.js';
import { llmModelVariable, resolveChatAi, type ChatAiResolution } from './chatAi.js';
import { aiConfigChoiceVariable } from './aiConfigChoice.js';

export { fetchAgentAIConfig } from './chatAi.js';

/** Result of a single chat turn surfaced to the frontend. */
export interface ChatTurnResult {
  assistantMessage: string;
  stageTransitioned: boolean;
  newStageName: string | null;
  conversationHandoff: string | null;
  chatEnded: boolean;
  onTrack: boolean;
  offTrackReason: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Run one full Chat API turn:
 *   sendChatMessage → LLM call → processChatResponse.
 *
 * Used by both the `/turn` and `/start` endpoints. `/start` passes a null
 * userMessage after it has already called startChat (so it just needs to
 * kick off the LLM against the compiled system prompt with no user input
 * yet — the "welcome" path). For regular turns, userMessage is the user's
 * input.
 */
export async function runChatTurn(args: {
  token: string | null;
  agentId: string;
  chatId: string;
  userMessage: string | null;
  /** App context for config resolution (App chat tab). Optional — the
   *  agent-builder chat omits it and resolves in agent-context. */
  appId?: string | null;
  /** Named config to run with, honoured only without an App (the Tester). Defaults to `default`. In an App the
   *  config resolves from `aiConfigChoice`, else the chat (portal#1963). */
  configName?: string | null;
  /** portal#1963: the AI config choice the user made, sent with sendChatMessage so the server stores it.
   *  Omitted when no choice was made. The welcome turn never sends it (startChat already did). */
  aiConfigChoice?: string;
  /** Pre-fetched startChat response for the welcome turn. Omitted for
   *  regular turns — in that case we call sendChatMessage first. */
  startPayload?: {
    systemMessage: string;
    tools: HadronTool[] | null;
  };
  /** portal#1611: the config this REQUEST already resolved (before startChat),
   *  reused for every turn of it, so the model reported to the server is the
   *  model that runs. Omitted: this turn resolves its own. A failed
   *  resolution is rethrown here, exactly as if this turn had resolved it. */
  ai?: ChatAiResolution;
}): Promise<ChatTurnResult> {
  const { token, agentId, chatId, userMessage, appId, configName, startPayload } = args;
  const client = gqlClient(token);

  // 1. The agent's decrypted AI config (resolved once per request when the
  //    caller already did so).
  const resolution = args.ai ?? await resolveChatAi(token, agentId, { appId, configName, chatId, aiConfigChoice: args.aiConfigChoice });
  if (!resolution.ok) throw resolution.error;
  const ai = resolution.ai;

  // 2. Get the compiled system prompt + tool schema + message history
  let systemMessage: string;
  let tools: HadronTool[] | null;
  let messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  let summarizationNeeded: { messageCount: number; prompt: string } | null = null;

  if (startPayload) {
    // Welcome turn: no user message, no prior history, just the compiled
    // stage prompt from the startChat call.
    systemMessage = startPayload.systemMessage;
    tools = startPayload.tools;
    messageHistory = [];
  } else {
    if (userMessage == null) {
      throw new Error('userMessage is required for regular turns');
    }
    const sendResult = await client.request<{
      sendChatMessage: {
        systemMessage: string;
        tools: HadronTool[] | null;
        messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
        summarizationNeeded: { messageCount: number; prompt: string } | null;
      };
    }>(SEND_CHAT_MESSAGE_MUTATION, { chatId, userMessage, ...llmModelVariable(resolution), ...aiConfigChoiceVariable(args.aiConfigChoice) });
    systemMessage = sendResult.sendChatMessage.systemMessage;
    tools = sendResult.sendChatMessage.tools;
    messageHistory = sendResult.sendChatMessage.messageHistory ?? [];
    summarizationNeeded = sendResult.sendChatMessage.summarizationNeeded;
  }

  // 3. Call the LLM with the tool contract
  const llmResult = await callAgentChatLlm({
    provider: ai.provider,
    apiKey: ai.apiKey,
    model: ai.model,
    systemMessage,
    tools,
    messages: messageHistory,
  });

  // 4. Hand the tool call back to Hadron so it can save the assistant
  //    message, extract data, and transition stages atomically.
  const processed = await client.request<{
    processChatResponse: {
      displayMessage: string;
      stageTransitioned: boolean;
      newStageName: string | null;
      conversationHandoff: string | null;
      chatEnded: boolean;
      onTrack: boolean;
      offTrackReason: string | null;
    };
  }>(PROCESS_CHAT_RESPONSE_MUTATION, {
    chatId,
    toolResponse: llmResult.respond,
  });

  // 5. Fire-and-forget summarization if the chat has grown past the
  //    trigger count. We run a separate LLM call with the summarization
  //    prompt and a plain text completion (no tools) and store it via
  //    saveChatSummary. Errors are swallowed so they don't break the turn.
  if (summarizationNeeded) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      try {
        const summaryResult = await callAgentChatLlm({
          provider: ai.provider,
          apiKey: ai.apiKey,
          model: ai.model,
          systemMessage: summarizationNeeded!.prompt,
          tools: null,   // plain text
          messages: messageHistory,
        });
        const summary = summaryResult.respond.message ?? summaryResult.rawText;
        if (summary) {
          await client.request(SAVE_CHAT_SUMMARY_MUTATION, { chatId, summary });
        }
      } catch (err) {
        console.warn('[agent-chat] summarization failed:', publicChatError(err).code);
      }
    })();
  }

  return {
    assistantMessage: processed.processChatResponse.displayMessage,
    stageTransitioned: processed.processChatResponse.stageTransitioned,
    newStageName: processed.processChatResponse.newStageName,
    conversationHandoff: processed.processChatResponse.conversationHandoff,
    chatEnded: processed.processChatResponse.chatEnded,
    onTrack: processed.processChatResponse.onTrack,
    offTrackReason: processed.processChatResponse.offTrackReason,
    usage: llmResult.usage,
  };
}
