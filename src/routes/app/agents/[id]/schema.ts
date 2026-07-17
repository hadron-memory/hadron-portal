import { z } from 'zod';
import { validateAtomShape } from '$lib/urn/parse-urn';

function agentSlugField() {
  return z
    .string()
    .trim()
    .min(1, 'URN is required.')
    .superRefine((slug, ctx) => {
      if (!slug) return;
      try {
        validateAtomShape(slug, slug);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'Agent URN may use lowercase letters, numbers, dots, underscores, and hyphens, and must start and end with a letter or number.',
        });
      }
    });
}

export const agentSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  urnSlug: agentSlugField(),
  description: z.string().trim().default(''),
  systemPrompt: z.string().trim().default(''),
  visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('ORGANIZATION'),
  systemMemoryId: z.string().trim().default(''),
});

export type AgentSettingsSchema = typeof agentSettingsSchema;
