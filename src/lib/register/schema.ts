import { z } from 'zod';
import { t } from '$lib/i18n/t';

/**
 * #942 slice 3 — the register. A row says an attendee TAKES PART in a Channel
 * (Watch / Post / Both, optionally only when mentioned). It is intent, never
 * permission: what the attendee may read or post is the host memory's call.
 * `attendee` is a Worker's or an installed Agent's id; empty = everyone in the
 * owner's context (the App, or the organization).
 *
 * Shared by the App Channels page and the organization's Channels page: the
 * forms are the same, and only the owner (`ownerRef`) differs.
 */
export const REGISTER_ROLES = ['WATCH', 'POST', 'BOTH'] as const;
export const REGISTER_DESCRIPTION_MAX = 500;

const NOTE_TOO_LONG = t('app.channels.validation.note-too-long', 'Keep the note to {max} characters.', { max: String(REGISTER_DESCRIPTION_MAX) });

export const addAttendanceSchema = z.object({
  _kind: z.literal('addAttendance').default('addAttendance'),
  channelId: z.string().trim().min(1, t('app.channels.validation.pick-channel', 'Pick a channel.')).prefault(''),
  attendee: z.string().trim().prefault(''),
  role: z.enum(REGISTER_ROLES).default('BOTH'),
  mentionOnly: z.boolean().default(false),
  description: z.string().trim().max(REGISTER_DESCRIPTION_MAX, NOTE_TOO_LONG).prefault(''),
});

export const editAttendanceSchema = z.object({
  _kind: z.literal('editAttendance').default('editAttendance'),
  ref: z.string().trim().min(1).prefault(''),
  role: z.enum(REGISTER_ROLES).default('BOTH'),
  mentionOnly: z.boolean().default(false),
  description: z.string().trim().max(REGISTER_DESCRIPTION_MAX, NOTE_TOO_LONG).prefault(''),
});

export const removeAttendanceSchema = z.object({
  _kind: z.literal('removeAttendance').default('removeAttendance'),
  ref: z.string().trim().min(1).prefault(''),
});
