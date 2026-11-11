/**
 * Which tab and which conversation a URL asks the App page to open (#744).
 *
 * Extracted from the page loader so it can be tested at all (@copilot on #846).
 * The loader around it fires ~10 GraphQL queries and several `superValidate`
 * calls, so exercising four lines of URL parsing through it would mean mocking
 * the whole page; these rules are pure, so they belong beside `release-notice`
 * and `hold-stale` rather than inside the load.
 */
import { AGENT_CHAT_KEY, TEAM_CHAT_LOC } from '$lib/app-chats';
import { lookupOwn } from '$lib/lookup';

/** The App page's tab ids, for validating `?tab=`. The page's `TabId` is
 *  derived from this list, so a tab added here is addressable and one added
 *  only in the page fails to type-check; an unknown value falls back to the
 *  default.
 *
 *  #1007/#1008: `keys` and `ai-configs` were sections of Settings; they are
 *  their own tabs now, so each is linkable on its own. #1005/#1006: so are
 *  `members` (the former /members page) and `agents` (Settings' Agent section). */
export const APP_TAB_IDS = [
  'chats',
  'worklog',
  'runs',
  'staff',
  'members',
  'agents',
  'memory',
  'keys',
  'ai-configs',
  'settings',
  'node-role-templates',
  'client',
] as const;

export type AppTabId = (typeof APP_TAB_IDS)[number];

/**
 * #744 folded the separate `chat` (agent) and `team-chat` tabs into one `chats`
 * tab. Those ids are in the wild — in PR descriptions, team-chat messages and
 * anyone's bookmarks — so they still resolve, to the Chats tab with the right
 * conversation preselected. Dropping them would land the reader on the default
 * tab with no indication anything was redirected.
 *
 * Kept as an explicit alias map rather than a silent fallback: an unknown tab
 * SHOULD fall back, a retired-but-known one should land where it moved to.
 */
export const RETIRED_TAB_ALIASES: Record<string, { tab: string; chat: string }> = {
  chat: { tab: 'chats', chat: AGENT_CHAT_KEY },
  'team-chat': { tab: 'chats', chat: TEAM_CHAT_LOC },
};

export interface TabIntent {
  /** The tab to open, or null to let the page use its default. */
  initialTab: string | null;
  /** The conversation to preselect, or null. */
  requestedChat: string | null;
}

/**
 * Resolve `?tab=` and `?chat=` into what the page should open.
 *
 * `?tab=` is validated against the known set and coerced to **null** otherwise,
 * so an unknown value falls back to the default rather than rendering a blank
 * page where no tab body matches.
 *
 * #835 — the alias lookup goes through `lookupOwn`. This key is whatever a
 * visitor types into `?tab=`, and an inherited one (`?tab=constructor`) made
 * `alias` truthy, so `initialTab` came out `undefined` where the rule above
 * says null. Benign downstream (the page does `?? 'chats'`), but the code and
 * its stated contract disagreed — and this is the site that shows how short the
 * distance is from "our own enum" to attacker-typed: one `searchParams.get`.
 */
export function resolveTabIntent(searchParams: URLSearchParams): TabIntent {
  const rawTab = searchParams.get('tab');
  const alias = lookupOwn(RETIRED_TAB_ALIASES, rawTab);
  const initialTab = alias
    ? alias.tab
    : (APP_TAB_IDS as readonly string[]).includes(rawTab ?? '') ? rawTab : null;
  // An explicit ?chat= wins over the one a retired tab id implies, so a link
  // carrying both is not silently overridden by the alias.
  const requestedChat = searchParams.get('chat') ?? alias?.chat ?? null;
  return { initialTab, requestedChat };
}
