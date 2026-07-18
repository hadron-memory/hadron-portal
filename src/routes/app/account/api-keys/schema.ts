import { z } from 'zod';
import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';

/** Mirrors hadron-server's USER_API_KEY_LABEL_MAX_LEN. */
export const API_KEY_LABEL_MAX_LEN = 200;

export const createUserApiKeySchema = z.object({
  label: z
    .string()
    .trim()
    .max(API_KEY_LABEL_MAX_LEN, i18n.labelTooLong(API_KEY_LABEL_MAX_LEN))
    .default(''),
});

export type CreateUserApiKeySchema = typeof createUserApiKeySchema;
