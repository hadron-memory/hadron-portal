import { z } from 'zod';
import { handleField } from '$lib/forms/zod-validators';

export const accountProfileSchema = z.object({
  name: z.string().trim().default(''),
  handle: handleField(),
  email: z.string().trim().default(''),
});

export type AccountProfileSchema = typeof accountProfileSchema;
