import { z } from 'zod';
import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';

/** Mirrors hadron-server's USER_API_KEY_LABEL_MAX_LEN. */
export const API_KEY_LABEL_MAX_LEN = 200;

export const createUserApiKeySchema = z.object({
  _kind: z.literal('createUserApiKey').default('createUserApiKey'),
  label: z
    .string()
    .trim()
    .max(API_KEY_LABEL_MAX_LEN, i18n.labelTooLong(API_KEY_LABEL_MAX_LEN))
    .default(''),
});

export type CreateUserApiKeySchema = typeof createUserApiKeySchema;

export const revokeUserApiKeySchema = z.object({
  _kind: z.literal('revokeUserApiKey').default('revokeUserApiKey'),
  id: z.string().trim().min(1, 'Missing key id.').prefault(''),
});

export type RevokeUserApiKeySchema = typeof revokeUserApiKeySchema;

// Boolean strings are explicit: omitted, blank and arbitrary truthy values are invalid.
export const keyVisibilitySchema = z.object({
  id: z.string().trim().min(1),
  hidden: z.enum(['true', 'false']).transform(value => value === 'true'),
});
