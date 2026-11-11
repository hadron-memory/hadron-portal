/**
 * portal#1963: which AI config a chat runs with (hadron-server#3957,
 * hrn:node:hadronmemory.com:specs:cor:dmo:050:10). Client-safe: no key, key
 * preview, params or endpoint ever reaches an option.
 *
 * The server's `chatAiConfigChoices` lists the App's OWN enabled configs plus
 * one `default` entry. A chat stores its choice; with none stored, the server
 * uses the App's chatbot config, else `default`. A stored choice the server
 * no longer counts (deleted, disabled, another App's) is skipped the same way,
 * so the dropdown mirrors that order rather than guessing.
 */
import { t } from '$lib/i18n/t';

/** The `default` entry's value: the App -> Agent -> Org -> Host walk. */
export const DEFAULT_CHAT_AI_CHOICE = 'default';

export type ChatAiChoiceOption = {
  /** `default`, else the config id: what goes back as `aiConfigChoice`. */
  value: string;
  name: string;
  provider: string | null;
  model: string | null;
  isDefault: boolean;
  isAppChatbotConfig: boolean;
  /** Why the portal can't run this config yet, or null when it can. Not the config's own enabled flag:
   *  the server's list never carries a disabled config. */
  unavailableReason: string | null;
};

/** The value the dropdown shows: the stored choice while the list has it, else the App's chatbot config, else `default`. */
export function initialChatAiChoice(options: readonly ChatAiChoiceOption[], stored: string | null | undefined): string {
  if (stored && options.some((o) => o.value === stored)) return stored;
  const appConfig = options.find((o) => o.isAppChatbotConfig && !o.isDefault && o.unavailableReason === null);
  return appConfig?.value ?? DEFAULT_CHAT_AI_CHOICE;
}

/** The config name the portal resolves a choice by; null for a value the list does not have. */
export function configNameForChoice(options: readonly ChatAiChoiceOption[], value: string): string | null {
  if (value === DEFAULT_CHAT_AI_CHOICE) return DEFAULT_CHAT_AI_CHOICE;
  return options.find((o) => o.value === value)?.name ?? null;
}

export function chatAiChoiceLabel(o: ChatAiChoiceOption): string {
  if (o.isDefault) return t('agent-chat.ai-config.default', 'Default');
  const parts = [o.provider, o.model].filter((p): p is string => typeof p === 'string' && p !== '');
  let label = parts.length > 0 ? `${o.name} (${parts.join(' · ')})` : o.name;
  if (o.isAppChatbotConfig) label += ` · ${t('agent-chat.ai-config.app-chatbot', 'App chatbot config')}`;
  if (o.unavailableReason) label += ` · ${o.unavailableReason}`;
  return label;
}

/**
 * The loader's options, narrowed to what the page's live config read still has. The loader reads the list
 * once; an AI-tab delete or disable afterwards must drop that entry rather than leave a choice the server
 * would refuse. `configs` null with `readFailed` (a refresh after a mutation failed) keeps only `default`:
 * nothing else can be vouched for. `configs` null without it (the loader couldn't read them) keeps the
 * list as the server sent it. A config created after load appears only on reload.
 */
export function liveChatAiChoices(
  options: readonly ChatAiChoiceOption[] | null,
  configs: readonly { id: string; enabled?: boolean | null }[] | null,
  readFailed: boolean,
): ChatAiChoiceOption[] | null {
  if (!options) return null;
  if (configs === null) return readFailed ? options.filter((o) => o.isDefault) : [...options];
  return options.filter((o) => o.isDefault || configs.some((c) => c.id === o.value && c.enabled !== false));
}
