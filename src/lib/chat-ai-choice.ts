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
import { portalRuntimeRefusal } from '$lib/llm/portalRuntime';

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

/**
 * The value the dropdown shows: the stored choice while the list has it, else the App's chatbot config, else
 * `default`. The App's chatbot config is shown even when the portal can't run it (its label says why): an
 * un-picked turn runs it all the same, so showing `default` would name a config that never runs (portal#1997).
 */
export function initialChatAiChoice(options: readonly ChatAiChoiceOption[], stored: string | null | undefined): string {
  if (stored && options.some((o) => o.value === stored)) return stored;
  const appConfig = options.find((o) => o.isAppChatbotConfig && !o.isDefault);
  return appConfig?.value ?? DEFAULT_CHAT_AI_CHOICE;
}

export function chatAiChoiceLabel(o: ChatAiChoiceOption): string {
  if (o.isDefault) return t('agent-chat.ai-config.default', 'Default');
  const parts = [o.provider, o.model].filter((p): p is string => typeof p === 'string' && p !== '');
  let label = parts.length > 0 ? `${o.name} (${parts.join(' · ')})` : o.name;
  if (o.isAppChatbotConfig) label += ` · ${t('agent-chat.ai-config.app-chatbot', 'App chatbot config')}`;
  if (o.unavailableReason) label += ` · ${o.unavailableReason}`;
  return label;
}

/** The masked config fields the dropdown's runtime label is computed from. Never a key or key preview. */
export type ChatAiRuntimeConfig = {
  id: string;
  name?: string | null;
  provider: string;
  model?: string | null;
  effectiveEndpoint?: string | null;
  hasApiKey?: boolean | null;
  enabled?: boolean | null;
};

/**
 * Why the portal can't run this config yet, or null when it can. The same check the runtime refuses with
 * before it uses a key (portalRuntimeRefusal), then whether a key reaches this session (`hasApiKey`, the masked
 * read's flag). Not the config's own enabled flag: a disabled config is never offered at all.
 */
export function runtimeUnavailableReason(config: ChatAiRuntimeConfig): string | null {
  if (portalRuntimeRefusal({ provider: config.provider, effectiveEndpoint: config.effectiveEndpoint ?? null })) {
    return t('agent-chat.ai-config.unavailable-runtime', "can't run in portal chats yet");
  }
  if (config.hasApiKey !== true) return t('agent-chat.ai-config.unavailable-key', 'no key available here');
  return null;
}

/**
 * The loader's options, brought in line with the page's live config read (portal#1963). The loader reads the
 * list once, so after an AI-tab edit:
 * - a config deleted or disabled drops out;
 * - one still there takes its live name, provider and model, and its runtime label is recomputed, so adding a
 *   key or fixing an endpoint enables it, and the reverse disables it (Juliet's BLIND F3).
 * `configs` null with `readFailed` (a refresh after a mutation failed) keeps only `default`: nothing else can
 * be vouched for. `configs` null without it (the loader couldn't read them) keeps the list as the server sent
 * it. A config created after load appears only on reload.
 */
export function liveChatAiChoices(
  options: readonly ChatAiChoiceOption[] | null,
  configs: readonly ChatAiRuntimeConfig[] | null,
  readFailed: boolean,
): ChatAiChoiceOption[] | null {
  if (!options) return null;
  if (configs === null) return readFailed ? options.filter((o) => o.isDefault) : [...options];
  const live: ChatAiChoiceOption[] = [];
  for (const o of options) {
    if (o.isDefault) {
      live.push(o);
      continue;
    }
    const c = configs.find((x) => x.id === o.value);
    if (!c || c.enabled === false) continue;
    live.push({
      ...o,
      name: c.name ?? o.name,
      provider: c.provider,
      model: c.model ?? null,
      unavailableReason: runtimeUnavailableReason(c),
    });
  }
  return live;
}
