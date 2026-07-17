import { z } from 'zod';
import { handleField } from '$lib/forms/zod-validators';

const optionalEmailField = z
  .string()
  .trim()
  .default('')
  .refine((email) => !email || z.string().email().safeParse(email).success, 'Enter a valid email address.');

export const accountProfileSchema = z.object({
  name: z.string().trim().default(''),
  handle: handleField(),
  email: optionalEmailField,
});

export type AccountProfileSchema = typeof accountProfileSchema;
