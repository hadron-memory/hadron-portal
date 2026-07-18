import { z } from 'zod';

export const inviteEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.')
    .default(''),
});

export type InviteEmailSchema = typeof inviteEmailSchema;
