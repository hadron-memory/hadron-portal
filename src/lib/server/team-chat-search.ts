// Team-chat history search (#1013, server#2299 / server#2882).
//
// `teamChatSearch` answers with REFERENCES only, so each hit's text is read back
// through the existing channel read path. That read is the masking boundary: the
// portal never searches or filters message text itself.
import type { GraphQLClient } from 'graphql-request';
import {
  TEAM_CHAT_SEARCH_REFUSALS,
  type TeamChatSearchHit,
  type TeamChatSearchRefusal,
  type TeamChatSearchResponse,
} from '$lib/team-chat-search';
import { CHANNEL_HIT_MESSAGE_QUERY, TEAM_CHAT_SEARCH_QUERY } from './queries';

interface SearchMatch {
  nodeId: string;
  urn: string | null;
  seq: number;
  channelId: string;
  channelIncarnation: number;
}

function errorCodeOf(e: unknown): string | null {
  const errors = (e as { response?: { errors?: Array<{ extensions?: { code?: unknown } }> } })?.response?.errors;
  const code = Array.isArray(errors) ? errors[0]?.extensions?.code : undefined;
  return typeof code === 'string' ? code : null;
}

/** The typed refusal behind `e`, or `FAILED` for anything else (never shown as empty). */
export function searchRefusalOf(e: unknown): TeamChatSearchRefusal {
  const code = errorCodeOf(e);
  return (TEAM_CHAT_SEARCH_REFUSALS as readonly string[]).includes(code ?? '') ? (code as TeamChatSearchRefusal) : 'FAILED';
}

/**
 * Read one hit's message. A changed incarnation is a refusal of the whole page
 * (the channel was replaced under the search) and propagates; any other failure
 * leaves just that row without text.
 */
async function hydrate(client: GraphQLClient, match: SearchMatch): Promise<TeamChatSearchHit> {
  const bare: TeamChatSearchHit = { ...match, body: null, at: null, authorName: null };
  try {
    const r = await client.request<{
      channelMessages: { items: Array<{ seq: number; body: string; at: string; authorName: string | null }> };
    }>(CHANNEL_HIT_MESSAGE_QUERY, {
      channelRef: match.channelId,
      sinceSeq: match.seq - 1,
      expectedIncarnation: match.channelIncarnation,
    });
    // `sinceSeq` is exclusive, so the row at `seq` is the hit; anything else
    // means it is no longer readable and must not be shown as the hit.
    const m = r.channelMessages.items.find((i) => i.seq === match.seq);
    return m ? { ...bare, body: m.body, at: m.at, authorName: m.authorName } : bare;
  } catch (e) {
    if (errorCodeOf(e) === 'CHANNEL_INCARNATION_CHANGED') throw e;
    return bare;
  }
}

export async function searchTeamChat(
  client: GraphQLClient,
  appRef: string,
  query: string,
  cursor: string | null,
): Promise<TeamChatSearchResponse> {
  try {
    const { teamChatSearch: page } = await client.request<{
      teamChatSearch: {
        items: SearchMatch[];
        complete: boolean;
        cursor: string | null;
        channelId: string | null;
        channelIncarnation: number | null;
      };
    }>(TEAM_CHAT_SEARCH_QUERY, { appRef, query, ...(cursor ? { cursor } : {}) });
    const items = await Promise.all(page.items.map((m) => hydrate(client, m)));
    return {
      ok: true,
      items,
      complete: page.complete,
      cursor: page.cursor,
      channelId: page.channelId,
      channelIncarnation: page.channelIncarnation,
    };
  } catch (e) {
    return { ok: false, code: searchRefusalOf(e) };
  }
}
