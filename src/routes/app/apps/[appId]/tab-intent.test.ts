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
import { APP_TAB_IDS, resolveTabIntent } from './tab-intent';

const intent = (qs: string) => resolveTabIntent(new URLSearchParams(qs));

describe('resolveTabIntent', () => {
  it('passes a known tab through', () => {
    expect(intent('tab=worklog')).toEqual({ initialTab: 'worklog', requestedChat: null });
  });

  it.each(APP_TAB_IDS)('accepts the known tab id %s', (tab) => {
    expect(intent(`tab=${tab}`).initialTab).toBe(tab);
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

  it('keeps ?chat= without a ?tab=', () => {
    expect(intent('chat=custom')).toEqual({ initialTab: null, requestedChat: 'custom' });
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
