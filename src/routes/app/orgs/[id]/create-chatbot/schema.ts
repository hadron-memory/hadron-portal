import { z } from 'zod';
import { agentSlugField, memorySlugField, optionalMemorySlugField } from '$lib/forms/zod-validators';

const booleanField = z.preprocess((value) => value === true || value === 'true', z.boolean());

export const createChatbotSchema = z
  .object({
    agentName: z.string().trim().min(1, 'Agent name is required.'),
    agentSlug: agentSlugField(),
    agentDescription: z.string().trim().default(''),
    systemPrompt: z.string().trim().default(''),
    visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('PERSONAL'),
    includeKnowledge: booleanField.default(true),
    knowledgeMemoryName: z.string().trim().default(''),
    knowledgeMemorySlug: optionalMemorySlugField(),
    systemMemorySlug: memorySlugField('System memory URN is required.'),
  })
  .superRefine((data, ctx) => {
    if (!data.includeKnowledge) return;
    if (!data.knowledgeMemoryName) {
      ctx.addIssue({
        code: 'custom',
        path: ['knowledgeMemoryName'],
        message: 'Knowledge memory name is required.',
      });
    }
    if (!data.knowledgeMemorySlug) {
      ctx.addIssue({
        code: 'custom',
        path: ['knowledgeMemorySlug'],
        message: 'Knowledge memory URN is required.',
      });
    }
  });

export type CreateChatbotSchema = typeof createChatbotSchema;
