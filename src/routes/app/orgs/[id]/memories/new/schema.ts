import { z } from 'zod';
import { validateMemorySlugField } from '$lib/urn/form-validation';

const optionalUrl = z.string().trim().refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Enter a valid URL.');

export const createMemorySchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required.'),
  slug: z
    .string()
    .trim()
    .min(1, 'URN slug is required.')
    .superRefine((slug, ctx) => {
      const error = validateMemorySlugField(slug);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    }),
  shortDescription: z.string().trim().default(''),
  description: z.string().trim().default(''),
  tags: z.string().trim().default(''),
  license: z.string().trim().default(''),
  category0: z.string().trim().default(''),
  category1: z.string().trim().default(''),
  category2: z.string().trim().default(''),
  iconUrl: optionalUrl.default(''),
  heroUrl: optionalUrl.default(''),
  homeUrl: optionalUrl.default(''),
  source: optionalUrl.default(''),
  readBranch: z.string().trim().default(''),
  writeBranch: z.string().trim().default(''),
  memoryClass: z.enum(['knowledge', 'personal', 'private']).default('knowledge'),
  visibility: z.enum(['ORGANIZATION', 'PUBLIC']).default('ORGANIZATION'),
});

export type CreateMemorySchema = typeof createMemorySchema;
