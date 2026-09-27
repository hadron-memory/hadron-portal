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

// The register forms are shared with the organization's Channels page
// (#942, org-owned rows), so they live in $lib/register.
export {
  REGISTER_ROLES,
  REGISTER_DESCRIPTION_MAX,
  addAttendanceSchema,
  editAttendanceSchema,
  removeAttendanceSchema,
} from '$lib/register/schema';
