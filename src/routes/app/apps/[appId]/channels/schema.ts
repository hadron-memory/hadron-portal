import { z } from 'zod';
import { t } from '$lib/i18n/t';

/**
 * #942: the App Channels page's three forms. `_kind` discriminates them, since
 * all three results can round-trip through the one page.
 *
 * The address is asked for as a short NAME and composed into `chats:<name>`:
 * a non-technical owner should not type a raw loc, and `chats:*` is the
 * convention the App page's chat selector discovers (src/lib/app-chats.ts).
 */
export const CHANNEL_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const CHANNEL_NAME_MAX = 120;
export const CHANNEL_DESCRIPTION_MAX = 500;

const NAME_TOO_LONG = t('app.channels.validation.name-too-long', 'Keep the name to {max} characters.', { max: String(CHANNEL_NAME_MAX) });
const DESCRIPTION_TOO_LONG = t('app.channels.validation.description-too-long', 'Keep the description to {max} characters.', { max: String(CHANNEL_DESCRIPTION_MAX) });

export const createChannelSchema = z.object({
  _kind: z.literal('createChannel').default('createChannel'),
  name: z.string().trim().min(1, t('app.channels.validation.name-required', 'Give the channel a name.')).max(CHANNEL_NAME_MAX, NAME_TOO_LONG).prefault(''),
  slug: z
    .string()
    .trim()
    .regex(CHANNEL_SLUG, t('app.channels.validation.slug', 'Use lowercase letters, digits and dashes, starting with a letter or digit.'))
    .prefault(''),
  description: z.string().trim().max(CHANNEL_DESCRIPTION_MAX, DESCRIPTION_TOO_LONG).prefault(''),
});

export const renameChannelSchema = z.object({
  _kind: z.literal('renameChannel').default('renameChannel'),
  ref: z.string().trim().min(1).prefault(''),
  name: z.string().trim().min(1, t('app.channels.validation.rename-name-required', 'A channel needs a name.')).max(CHANNEL_NAME_MAX, NAME_TOO_LONG).prefault(''),
  description: z.string().trim().max(CHANNEL_DESCRIPTION_MAX, DESCRIPTION_TOO_LONG).prefault(''),
});

export const deleteChannelSchema = z.object({
  _kind: z.literal('deleteChannel').default('deleteChannel'),
  ref: z.string().trim().min(1).prefault(''),
});

/** The reserved address a create composes from the short name. */
export function channelLoc(slug: string): string {
  return `chats:${slug}`;
}

/**
 * #942 slice 3 — the register. A row says an attendee TAKES PART in a Channel
 * (Watch / Post / Both, optionally only when mentioned). It is intent, never
 * permission: what the attendee may read or post is the host memory's call.
 * `attendee` is a Worker's or an installed Agent's id; empty = everyone in the App.
 */
export const REGISTER_ROLES = ['WATCH', 'POST', 'BOTH'] as const;
export const REGISTER_DESCRIPTION_MAX = 500;

export const addAttendanceSchema = z.object({
  _kind: z.literal('addAttendance').default('addAttendance'),
  channelId: z.string().trim().min(1, t('app.channels.validation.pick-channel', 'Pick a channel.')).prefault(''),
  attendee: z.string().trim().prefault(''),
  role: z.enum(REGISTER_ROLES).default('BOTH'),
  mentionOnly: z.boolean().default(false),
  description: z.string().trim().max(REGISTER_DESCRIPTION_MAX).prefault(''),
});

export const editAttendanceSchema = z.object({
  _kind: z.literal('editAttendance').default('editAttendance'),
  ref: z.string().trim().min(1).prefault(''),
  role: z.enum(REGISTER_ROLES).default('BOTH'),
  mentionOnly: z.boolean().default(false),
  description: z.string().trim().max(REGISTER_DESCRIPTION_MAX).prefault(''),
});

export const removeAttendanceSchema = z.object({
  _kind: z.literal('removeAttendance').default('removeAttendance'),
  ref: z.string().trim().min(1).prefault(''),
});
