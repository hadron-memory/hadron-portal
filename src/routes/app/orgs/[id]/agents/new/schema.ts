import { z } from 'zod';
import { agentSlugField } from '$lib/forms/zod-validators';

export const createAgentSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required.'),
  slug: agentSlugField(),
  description: z.string().trim().default(''),
  visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('PERSONAL'),
});

export type CreateAgentSchema = typeof createAgentSchema;
