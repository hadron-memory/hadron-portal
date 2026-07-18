import { z } from 'zod';

export const authEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.')
    .prefault(''),
  redirect: z.string().trim().optional(),
});

export type AuthEmailSchema = typeof authEmailSchema;
