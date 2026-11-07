import { t } from '$lib/i18n/t';
import { z } from 'zod';

const optionalEmailSchema = z.union([
  z.literal(''),
  z.string().email(t('account.invite.invalid-email', 'Enter a valid email address.')),
]);

export const accountInviteSchema = z.object({
  inviteName: z.string().trim().default(''),
  inviteEmail: z
    .string()
    .trim()
    .default('')
    .pipe(optionalEmailSchema),
  inviteGithub: z.string().trim().default(''),
});

export type AccountInviteSchema = typeof accountInviteSchema;
