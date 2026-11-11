/**
 * portal#1963: the chatbot dropdown's options, from the server's list
 * (hadron-server#3957, chatAiConfigChoices) and the masked config read the
 * page already makes (resolveAiServiceConfigs).
 *
 * The list says WHICH configs a chat may choose; only the config read says
 * whether THIS runtime can call one (its endpoint, and whether a key reaches
 * the session). A config the portal can't run yet is kept, with a short reason,
 * never hidden (the issue's ask 3). Fields are copied one by one, so nothing
 * from the config read (key preview, endpoint, params) can ride along.
 */
import { runtimeUnavailableReason, type ChatAiChoiceOption } from '$lib/chat-ai-choice';

/** One entry of `chatAiConfigChoices`, as selected. */
export type ChatAiChoiceRow = {
  value: string;
  name: string;
  provider: string | null;
  model: string | null;
  isDefault: boolean;
  isAppChatbotConfig: boolean;
};

/** The fields of a masked config read this module looks at. */
export type ChatAiConfigRuntimeRow = {
  id: string;
  provider: string;
  effectiveEndpoint?: string | null;
  hasApiKey?: boolean | null;
  /** Carried by the masked read the page passes in; never looked at, never copied. */
  apiKeyPreview?: string | null;
};

function unavailableReason(row: ChatAiChoiceRow, configs: readonly ChatAiConfigRuntimeRow[] | null): string | null {
  if (row.isDefault || !configs) return null;
  const config = configs.find((c) => c.id === row.value);
  // `hasApiKey` is the masked read's flag; the key itself is never read here.
  return config ? runtimeUnavailableReason({ id: config.id, provider: config.provider, effectiveEndpoint: config.effectiveEndpoint, hasApiKey: config.hasApiKey }) : null;
}

export function chatAiChoiceOptions(
  choices: readonly ChatAiChoiceRow[],
  configs: readonly ChatAiConfigRuntimeRow[] | null,
): ChatAiChoiceOption[] {
  return choices.map((row) => ({
    value: row.value,
    name: row.name,
    provider: row.provider ?? null,
    model: row.model ?? null,
    isDefault: row.isDefault,
    isAppChatbotConfig: row.isAppChatbotConfig,
    unavailableReason: unavailableReason(row, configs),
  }));
}
