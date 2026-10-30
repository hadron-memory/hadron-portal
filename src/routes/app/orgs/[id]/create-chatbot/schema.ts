import { z } from 'zod';
import { agentSlugField, memorySlugField } from '$lib/forms/zod-validators';
import { validateMemorySlugField } from '$lib/urn/form-validation';

const booleanField = z.preprocess((value) => value === true || value === 'true', z.boolean());

export const createChatbotSchema = z
  .object({
    agentName: z.string().trim().min(1, 'Agent name is required.'),
    agentSlug: agentSlugField(),
    agentDescription: z.string().trim().default(''),
    visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('PERSONAL'),
    includeKnowledge: booleanField.default(true),
    knowledgeMemoryName: z.string().trim().default(''),
    knowledgeMemorySlug: z.string().trim().default(''),
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
      return;
    }
    const knowledgeSlugError = validateMemorySlugField(data.knowledgeMemorySlug);
    if (knowledgeSlugError) {
      ctx.addIssue({
        code: 'custom',
        path: ['knowledgeMemorySlug'],
        message: knowledgeSlugError,
      });
    }
  });

export type CreateChatbotSchema = typeof createChatbotSchema;
