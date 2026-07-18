import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').default(''),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.')
    .default(''),
  message: z.string().trim().min(1, 'Message is required.').default(''),
});

export type ContactSchema = typeof contactSchema;
