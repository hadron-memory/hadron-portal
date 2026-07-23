import { z } from 'zod';
import { memorySlugField } from '$lib/forms/zod-validators';

// #627: create a user-owned (org-less) memory. Trimmed vs the org create form —
// only the owner-only classes are valid without an org (spec 047), and the
// marketplace/org fields (visibility, categories, license, branches) don't
// apply to a personal memory.
export const createPersonalMemorySchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required.'),
  slug: memorySlugField(),
  description: z.string().trim().default(''),
  memoryClass: z.enum(['personal', 'private']).default('personal'),
});

export type CreatePersonalMemorySchema = typeof createPersonalMemorySchema;
