import { z } from 'zod';
import { agentSlugField } from '$lib/forms/zod-validators';

// #636: org-less "create an agent" form for individual users. Mirrors the
// org-scoped createAgentSchema, trimmed to the fields that apply to a user-owned
// agent — visibility is fixed to PERSONAL server-side (no org to share with; the
// user can change it later on the agent page).
export const createPersonalAgentSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required.'),
  slug: agentSlugField(),
  description: z.string().trim().default(''),
});

export type CreatePersonalAgentSchema = typeof createPersonalAgentSchema;
