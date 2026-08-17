import { z } from 'zod';

/**
 * Posting to a team App's TEAM CHAT (hadron-portal#732).
 *
 * Distinct from `sendChatMessageSchema`, which posts to a chat NODE addressed
 * by memory + node id. This one carries no chat address at all: the server owns
 * the App's one well-known team chat and resolves it from the App, which is
 * what makes a portal post structurally unable to land in the wrong thread.
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
});

export type PostTeamChatMessageSchema = typeof postTeamChatMessageSchema;
