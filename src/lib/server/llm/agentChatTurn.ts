import { gqlClient } from '$lib/server/api';
import {
  AGENT_AI_CONFIG_QUERY,
  SEND_CHAT_MESSAGE_MUTATION,
  PROCESS_CHAT_RESPONSE_MUTATION,
  SAVE_CHAT_SUMMARY_MUTATION,
} from '$lib/server/queries';
import { callAgentChatLlm, type HadronTool } from './agentChatLlm.js';
import type { AIProvider } from '$lib/types';

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

/** Fetch the agent's decrypted LLM config. Throws on missing config. */
export async function fetchAgentAIConfig(
  token: string | null,
  agentId: string,
): Promise<{ provider: AIProvider; apiKey: string; model: string }> {
  const result = await gqlClient(token).request<{
    agentAIConfig: { provider: string; apiKey: string; model: string } | null;
  }>(AGENT_AI_CONFIG_QUERY, { agentId });
  if (!result.agentAIConfig) {
    throw new Error('Agent has no LLM provider configured. Set one in agent settings first.');
  }
  return {
    provider: result.agentAIConfig.provider as AIProvider,
    apiKey: result.agentAIConfig.apiKey,
    model: result.agentAIConfig.model,
  };
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
  /** Pre-fetched startChat response for the welcome turn. Omitted for
   *  regular turns — in that case we call sendChatMessage first. */
  startPayload?: {
    systemMessage: string;
    tools: HadronTool[] | null;
  };
}): Promise<ChatTurnResult> {
  const { token, agentId, chatId, userMessage, startPayload } = args;
  const client = gqlClient(token);

  // 1. Fetch the agent's decrypted AI config
  const ai = await fetchAgentAIConfig(token, agentId);

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
    }>(SEND_CHAT_MESSAGE_MUTATION, { chatId, userMessage });
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
        console.warn('[agent-chat] summarization failed:', err);
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
