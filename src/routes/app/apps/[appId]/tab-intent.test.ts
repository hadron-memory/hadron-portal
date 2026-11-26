/**
 * #744 / #835 / #846 — what `?tab=` and `?chat=` resolve to.
 *
 * These four lines lived inside the App page loader, where they had no test at
 * all: exercising them meant mocking ten GraphQL queries and several
 * `superValidate` calls. @copilot asked for the prototype-key regression on
 * #846 and the honest way to give it was to move the rules out, not to build
 * that mock.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_CHAT_KEY, TEAM_CHAT_LOC } from '$lib/app-chats';
import { APP_TAB_IDS, resolveSectionIntent, resolveTabIntent, SECTION_DATA_TAB, SETTINGS_SECTION_IDS, shouldLoadTeamRoster, visibleTabFor } from './tab-intent';

const intent = (qs: string) => resolveTabIntent(new URLSearchParams(qs));

describe('resolveTabIntent', () => {
  it('passes a known tab through', () => {
    expect(intent('tab=worklog')).toEqual({ initialTab: 'worklog', requestedChat: null });
  });

  // App Keys, AI Service Configs, Node-role templates, Secrets, Tickers, Stops and Channels are sections of Settings now: their old tab ids resolve to Settings (below).
  it.each(APP_TAB_IDS.filter((tab) => !['keys', 'ai-configs', 'node-role-templates', 'secrets', 'tickers', 'stops', 'channels'].includes(tab)))('accepts the known tab id %s', (tab) => {
    expect(intent(`tab=${tab}`).initialTab).toBe(tab);
  });

  it.each(['keys', 'ai-configs', 'node-role-templates', 'secrets', 'tickers', 'stops', 'channels'])('resolves the retired tab id %s to Settings, with that section open', (id) => {
    expect(intent(`tab=${id}`).initialTab).toBe('settings');
    expect(resolveSectionIntent(new URLSearchParams(`tab=${id}`))).toBe(id);
    expect(visibleTabFor(id)).toBe('settings');
  });

  it('opens the section ?section= names, and none for an unknown or absent one', () => {
    expect(resolveSectionIntent(new URLSearchParams('tab=settings&section=keys'))).toBe('keys');
    expect(resolveSectionIntent(new URLSearchParams('tab=settings&section=nonsense'))).toBeNull();
    expect(resolveSectionIntent(new URLSearchParams('tab=settings&section=constructor'))).toBeNull();
    expect(resolveSectionIntent(new URLSearchParams('tab=settings'))).toBeNull();
    expect(resolveSectionIntent(new URLSearchParams(''))).toBeNull();
  });

  it('every section id is unique, and each data section names a known tab id', () => {
    expect(new Set(SETTINGS_SECTION_IDS).size).toBe(SETTINGS_SECTION_IDS.length);
    for (const tab of Object.values(SECTION_DATA_TAB)) expect(APP_TAB_IDS).toContain(tab);
  });

  // portal#2241: Profile is addressable, and a tab-less URL still falls back to the page default
  // (Chats): making Profile the default is the gate's Proposed-pending-Holger item, not built here.
  it('accepts ?tab=profile, and ids it first in the list', () => {
    expect(intent('tab=profile').initialTab).toBe('profile');
    expect(APP_TAB_IDS[0]).toBe('profile');
  });

  it('is null with no ?tab=', () => {
    expect(intent('')).toEqual({ initialTab: null, requestedChat: null });
  });

  it('coerces an unknown tab to null rather than passing it through', () => {
    // A blank page where no tab body matches is the failure this prevents.
    expect(intent('tab=nonsense').initialTab).toBeNull();
    expect(intent('tab=').initialTab).toBeNull();
  });

  // #744: these ids are in the wild — PR descriptions, team-chat messages,
  // bookmarks — so they must keep resolving to where they moved.
  it('resolves the retired `chat` alias to the Chats tab with the agent chat', () => {
    expect(intent('tab=chat')).toEqual({ initialTab: 'chats', requestedChat: AGENT_CHAT_KEY });
  });

  it('resolves the retired `team-chat` alias to the Chats tab with the team chat', () => {
    expect(intent('tab=team-chat')).toEqual({ initialTab: 'chats', requestedChat: TEAM_CHAT_LOC });
  });

  it('lets an explicit ?chat= win over the one an alias implies', () => {
    expect(intent('tab=team-chat&chat=custom')).toEqual({
      initialTab: 'chats',
      requestedChat: 'custom',
    });
  });

  // Profile is the default only for a link naming neither: a conversation with no tab still means Chats, as it did
  // while Chats was the default, so an old shared link keeps landing on its chat.
  it('keeps ?chat= without a ?tab=, and opens it on Chats', () => {
    expect(intent('chat=custom')).toEqual({ initialTab: 'chats', requestedChat: 'custom' });
    expect(intent('')).toEqual({ initialTab: null, requestedChat: null });
  });

  // #835 — the reason this route was in the sweep at all. `?tab=` is the
  // shortest distance in the repo between "our own enum" and attacker-typed:
  // one `searchParams.get`. Indexed directly, `RETIRED_TAB_ALIASES['constructor']`
  // was the truthy Object constructor, so `alias.tab` made `initialTab` come
  // back as `undefined` where the documented rule is null.
  //
  // Asserting `toBeNull()`, not `toBeFalsy()` — undefined is falsy too, so the
  // weaker assertion passes on exactly the bug.
  it.each(Object.getOwnPropertyNames(Object.prototype))(
    'coerces the inherited tab key %s to null, and implies no chat',
    (key) => {
      const out = intent(`tab=${encodeURIComponent(key)}`);
      expect(out.initialTab).toBeNull();
      expect(out.requestedChat).toBeNull();
    },
  );
});

// #1005/#1006: the Human Team and Agents tabs are addressable.
describe('team tabs (#1005, #1006)', () => {
  it.each(['members', 'agents'])('accepts ?tab=%s', (tab) => {
    expect(resolveTabIntent(new URLSearchParams(`tab=${tab}`)).initialTab).toBe(tab);
  });
});

// portal#2238 (Holger's rule, ruling 0273): an App page loads only what its
// first screen renders. The AI Team grid is the roster's only consumer, so
// the loader reads the roster for NO other initial tab — on main the roster
// rode the page's Promise.all for every open and hung them all.
describe('which initial tab loads the roster (portal#2238)', () => {
  it('loads it for staff and for nothing else in the tab set, nor the default', () => {
    expect(shouldLoadTeamRoster('staff')).toBe(true);
    for (const id of APP_TAB_IDS) {
      if (id !== 'staff') expect(shouldLoadTeamRoster(id), `tab=${id}`).toBe(false);
    }
    // null is the no-?tab= default, resolved by the page to its default tab —
    // not the AI Team, so no roster there either.
    expect(shouldLoadTeamRoster(null)).toBe(false);
  });
});
