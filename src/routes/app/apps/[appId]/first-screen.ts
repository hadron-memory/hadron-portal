/**
 * portal#2240 (ruling 0273): "When opening the page of an app in the portal, it
 * should not load more than it renders on the first screen it shows."
 *
 * The App page's server load reads the FRAME (what the header renders on every
 * tab) plus the read groups of ONE tab: the tab the URL opens on, or, from the
 * page's `tab/+server.ts`, the tab the reader has just switched to. This module
 * is the single table both sides use, so the load, the endpoint and the page
 * cannot disagree about which payload keys a tab owns.
 *
 * A read belongs to a tab because that tab's panel RENDERS it (+page.svelte),
 * not because the old load happened to fetch it. Several reads serve more than
 * one tab, and are listed under each: staff feeds the AI Team grid, the team
 * chat's author chips and Settings' task integrations; the memory scope feeds
 * the Memory tab, the chat composer's writable targets and Settings' list.
 *
 * Pure, so it is pinned without the ~25-operation load around it.
 */
import { APP_TAB_IDS, SECTION_DATA_TAB, type AppTabId, type SettingsSectionId } from './tab-intent';

/** A named read of the App page, and the payload keys it produces. */
export const READ_GROUP_KEYS = {
  // `terminalNow` is a frame key (one cheap instant): the display clock seeds from it whichever tab opens first.
  staff: ['staff', 'staffError'],
  // portal#2238's bounded roster: read with an initial ?tab=staff only. Its key
  // is NOT owned here: `teamRoster` stays a frame key of the page load (null =
  // not loaded), the contract #2238's own first-show fetch (roster/+server.ts)
  // keys on, and the tab endpoint never sends it.
  roster: [],
  teamChat: ['teamChatMessages', 'teamChatTotal', 'teamChatError', 'teamFilter', 'teamFilterInvalid', 'teamChatRefusal'],
  chatList: [
    'appChats', 'chatsError', 'chatDeepLinkUnresolved', 'chatRootsError', 'channelsError', 'chatRootsPage',
    'selectedChannelId', 'selectedChannelMessages', 'selectedChannelTotal', 'selectedChannelError', 'postChannelMessageForm',
    'selectedChatKey', 'selectedChatMessages', 'selectedChatError', 'selectedChatTruncated', 'chatNotFound',
  ],
  chatConfigs: ['chatConfigs', 'aiChoices'],
  chatbotConfig: ['chatbotAiConfig'],
  wakeRoles: ['saturationWakeRoles'],
  worklog: ['worklog', 'worklogTotal', 'worklogPage', 'worklogError', 'worklogFilters'],
  members: ['members', 'membersError', 'membersWithheld'],
  availableAgents: ['availableAgents', 'availableAgentsError', 'subscribedAgentsError'],
  bootPointers: ['bootPointers'],
  installMarks: ['installMarks'],
  canManage: ['canManageApp'],
  // portal#1718: the org's members (the viewer's role), for the Memory tab's create offer and the AI Config section.
  orgMembers: ['orgMembers'],
  appNodes: ['appNodes', 'appNodesPage'],
  memoryScope: ['appMemoryScope'],
  // The Memory tab's list and create offer. The list is derived from the `memoryScope` group's read (every Memory
  // tab load takes both); this group owns the payload keys, and `canCreateMemory` is computed from the org read.
  appMemories: ['appMemories', 'canCreateMemory'],
  appKeys: ['appKeys'],
  keyScopes: ['keyScopes'],
  aiConfigs: ['appConfigs', 'configsPage', 'configsError'],
  runs: ['runsPanel'],
  templates: ['templatesPanel'],
} as const satisfies Record<string, readonly string[]>;

export type ReadGroup = keyof typeof READ_GROUP_KEYS;

/** What each tab's first screen reads, beyond the frame. */
export const TAB_READS: Record<AppTabId, readonly ReadGroup[]> = {
  // portal#2241: the App's identity renders from the frame's App read; the Edit in Settings link is the manage gate.
  profile: ['canManage'],
  chats: ['staff', 'teamChat', 'chatList', 'chatConfigs', 'memoryScope'],
  worklog: ['worklog'],
  runs: ['runs'],
  staff: ['staff', 'roster', 'installMarks'],
  members: ['members'],
  agents: ['availableAgents', 'bootPointers', 'installMarks', 'canManage'],
  memory: ['appNodes', 'memoryScope', 'appMemories', 'canManage', 'orgMembers'],
  keys: ['appKeys', 'keyScopes'],
  // portal#2567: the AI section shows its controls to the owner of a person's App, which the canManage read says.
  'ai-configs': ['aiConfigs', 'canManage', 'orgMembers'],
  settings: ['staff', 'chatbotConfig', 'wakeRoles', 'chatConfigs', 'canManage', 'memoryScope'],
  'node-role-templates': ['templates'],
  // The Client tab's plugin grid (canManage) and its key status (appKeys).
  client: ['canManage', 'appKeys'],
};

/** The tab a URL without a (valid) `?tab=` opens on; the page's own default. */
export const DEFAULT_TAB: AppTabId = 'profile';

/**
 * The read groups for one load.
 *
 * `frame` is the page load (the header renders); without it, the tab endpoint.
 * The roster is the page load's only: after a switch, #2238's first-show fetch
 * owns it, and a second copy here would ask twice.
 */
export function readGroupsFor(tab: string | null, mode: { frame: boolean }, section: SettingsSectionId | null = null): Set<ReadGroup> {
  const id = (APP_TAB_IDS as readonly string[]).includes(tab ?? '') ? (tab as AppTabId) : DEFAULT_TAB;
  const groups = new Set<ReadGroup>(TAB_READS[id]);
  // A link that names a Settings section opens it, so its data is part of the first screen. Only Settings has
  // sections: a `?section=` on another tab asks for nothing.
  const sectionTab = id === 'settings' && section ? SECTION_DATA_TAB[section] : undefined;
  if (sectionTab) for (const group of TAB_READS[sectionTab]) groups.add(group);
  if (!mode.frame) groups.delete('roster');
  return groups;
}

/** Every payload key some read group owns. A load returns only its own groups'. */
export const TAB_PAYLOAD_KEYS: ReadonlySet<string> = new Set(Object.values(READ_GROUP_KEYS).flat());

/**
 * Keep the frame's keys (`frame`) and the given groups' keys; drop the rest.
 *
 * Why drop rather than send them empty: the page merges a tab's payload over
 * what it already holds, so a key sent as "not loaded" by one tab's response
 * would overwrite another tab's real data.
 */
export function pickPayload<T extends Record<string, unknown>>(full: T, groups: ReadonlySet<ReadGroup>, mode: { frame: boolean }): Partial<T> {
  const keep = new Set<string>([...groups].flatMap((g) => READ_GROUP_KEYS[g]));
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(full)) {
    const owned = TAB_PAYLOAD_KEYS.has(key);
    if (owned ? keep.has(key) : mode.frame) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Does a live stop name a worker? Then the frame's banner needs worker names. */
export function liveStopsNameAWorker(live: { kind: string; value?: { signals: { targetWorkerId: string | null }[] } } | null | undefined): boolean {
  return live?.kind === 'ok' && !!live.value?.signals.some((s) => !!s.targetWorkerId);
}
