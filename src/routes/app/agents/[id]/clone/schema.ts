import { z } from 'zod';
import { t } from '$lib/i18n/t';

// Name and slug are optional: blank means the server's default (the portal
// predicts nothing). Slug rules are the server's; a taken slug comes back as a
// field error.
export const cloneAgentSchema = z.object({
  target: z.string().trim().min(1, t('agent.clone.target.required', 'Choose a target organization.')).prefault(''),
  name: z.string().trim().max(200).prefault(''),
  slug: z.string().trim().max(200).prefault(''),
});
