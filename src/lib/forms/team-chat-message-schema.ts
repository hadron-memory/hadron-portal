import { z } from 'zod';

/**
 * Posting to a team App's TEAM CHAT (hadron-portal#732).
 *
 * The default-team action ignores chat addresses and lets the server resolve
 * the App's default. #1033's separate addressed action requires channelRef,
 * checks its route App, and calls createChannelMessage with the same human
 * token. Neither path accepts a worker session or silently falls back.
 *
 * Lives in `$lib/forms` rather than beside the route so the component and the
 * route action share one definition — the same reason `chat-message-schema`
 * does.
 */
export const postTeamChatMessageSchema = z.object({
  _kind: z.literal('postTeamChatMessage').default('postTeamChatMessage'),
  // The cap mirrors the server's TEAM_CHAT_BODY_TOO_LARGE so an over-long body
  // is refused in the form, attached to the field, rather than as a round trip.
  body: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(65536, 'Message is too long (65536 characters max).')
    .prefault(''),
  // A string because it arrives from a hidden input. Empty means "not a reply"
  // and must reach the mutation as undefined rather than 0 — seq ascends from
  // 1, so 0 could only ever name a message that cannot exist.
  replyToSeq: z.string().trim().optional(),
  // #1033: optional only for the default-team convenience action.
  channelRef: z.string().trim().optional(),
});

export type PostTeamChatMessageSchema = typeof postTeamChatMessageSchema;
