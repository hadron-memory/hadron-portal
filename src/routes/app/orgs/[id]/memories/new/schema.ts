import { z } from 'zod';
import { memorySlugField, optionalHttpUrl } from '$lib/forms/zod-validators';

export const createMemorySchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required.'),
  slug: memorySlugField(),
  shortDescription: z.string().trim().default(''),
  description: z.string().trim().default(''),
  tags: z.string().trim().default(''),
  license: z.string().trim().default(''),
  category0: z.string().trim().default(''),
  category1: z.string().trim().default(''),
  category2: z.string().trim().default(''),
  iconUrl: optionalHttpUrl.default(''),
  heroUrl: optionalHttpUrl.default(''),
  homeUrl: optionalHttpUrl.default(''),
  source: optionalHttpUrl.default(''),
  readBranch: z.string().trim().default(''),
  writeBranch: z.string().trim().default(''),
  memoryClass: z.enum(['knowledge', 'personal', 'private']).default('knowledge'),
  visibility: z.enum(['ORGANIZATION', 'PUBLIC']).default('ORGANIZATION'),
});

export type CreateMemorySchema = typeof createMemorySchema;
