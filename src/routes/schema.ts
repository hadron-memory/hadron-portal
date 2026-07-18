import { z } from 'zod';

export const waitingListSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.')
    .prefault(''),
  requestedFeatures: z.string().trim().default(''),
});

export type WaitingListSchema = typeof waitingListSchema;
