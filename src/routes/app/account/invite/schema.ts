import { z } from 'zod';

export const accountInviteSchema = z.object({
  inviteName: z.string().trim().default(''),
  inviteEmail: z
    .string()
    .trim()
    .default('')
    .refine((email) => email === '' || z.string().email().safeParse(email).success, {
      message: 'Enter a valid email address.',
    }),
  inviteGithub: z.string().trim().default(''),
});

export type AccountInviteSchema = typeof accountInviteSchema;
