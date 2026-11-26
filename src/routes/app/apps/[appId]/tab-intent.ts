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
  // portal#2241: the App's own identity, read-only. Left-most and the page's default: a URL with no
  // `?tab=` opens it (Holger, 2026-11-23).
  'profile',
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
  'secrets',
  'tickers',
  'stops',
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

/**
 * The sections of the Settings tab, for `?section=` (a section opens collapsed unless a link names it).
 *
 * App Keys, AI Service Configs and Node-role templates were tabs of their own (#1007/#1008, #1936) and are
 * sections of Settings: the App's setup is one place, and a section nobody opens costs no read. Their old
 * `?tab=` ids still resolve, to Settings with that section open, for the same reason the retired chat ids do.
 */
export const SETTINGS_SECTION_IDS = [
  'app',
  'sweep-mode',
  'chatbot-ai-config',
  'wake-roles',
  'accessible-memories',
  'keys',
  'ai-configs',
  'node-role-templates',
  'secrets',
  'tickers',
  'stops',
  'danger-zone',
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/**
 * The Settings sections that read their own data, and the tab id that data is read under (the tab endpoint's
 * `?tab=`). A section nobody opens costs no read.
 */
export const SECTION_DATA_TAB: Partial<Record<SettingsSectionId, AppTabId>> = {
  keys: 'keys',
  'ai-configs': 'ai-configs',
  'node-role-templates': 'node-role-templates',
  secrets: 'secrets',
  tickers: 'tickers',
  stops: 'stops',
};

/** Tabs that became Settings sections: the tab id, and the section it now is. */
const TAB_TO_SECTION: Record<string, SettingsSectionId> = {
  keys: 'keys',
  'ai-configs': 'ai-configs',
  'node-role-templates': 'node-role-templates',
  secrets: 'secrets',
  tickers: 'tickers',
  stops: 'stops',
};

/** The Settings section a retired tab id became, or null. */
export function sectionForTab(id: string | null): SettingsSectionId | null {
  return id === null ? null : (lookupOwn(TAB_TO_SECTION, id) ?? null);
}

/** The tab that shows a tab id: Settings for a retired id that became one of its sections, else the id itself. */
export function visibleTabFor<T extends string | null>(id: T): T | 'settings' {
  return id !== null && lookupOwn(TAB_TO_SECTION, id) ? 'settings' : id;
}

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
  const namedTab = alias
    ? alias.tab
    : lookupOwn(TAB_TO_SECTION, rawTab) ? 'settings'
    : (APP_TAB_IDS as readonly string[]).includes(rawTab ?? '') ? rawTab : null;
  // An explicit ?chat= wins over the one a retired tab id implies, so a link
  // carrying both is not silently overridden by the alias.
  const requestedChat = searchParams.get('chat') ?? alias?.chat ?? null;
  // A link that names a conversation but no tab means the Chats tab, as it did while Chats was the page default;
  // Profile is the default only for a link that names neither.
  const initialTab = namedTab ?? (requestedChat !== null ? 'chats' : null);
  return { initialTab, requestedChat };
}

/**
 * The Settings section a URL asks to have open: `?section=`, or the one a retired tab id became.
 * Null for neither, and for an unknown value (every section then opens folded).
 */
export function resolveSectionIntent(searchParams: URLSearchParams): SettingsSectionId | null {
  const named = searchParams.get('section');
  if ((SETTINGS_SECTION_IDS as readonly string[]).includes(named ?? '')) return named as SettingsSectionId;
  return lookupOwn(TAB_TO_SECTION, searchParams.get('tab')) ?? null;
}

/**
 * portal#2238 (ruling 0273: an App page loads only what its first screen
 * renders) — does this INITIAL tab's first screen draw the roster?
 *
 * The AI Team grid is the roster's only consumer, so the loader reads the
 * roster for `staff` and for nothing else. `null` (no `?tab=`, the default
 * tab) is not the AI Team: the default tab must not pay for a list it never
 * shows. A reader who switches to AI Team afterwards gets the roster from
 * the page's own first-show fetch (`roster/+server.ts`), not from a request
 * this open already started — which is why the loader must not fire one
 * "just in case" (a streamed promise would: it starts the call on every
 * open, the exact defect this rule closes).
 */
export function shouldLoadTeamRoster(initialTab: string | null): boolean {
  return initialTab === 'staff';
}
