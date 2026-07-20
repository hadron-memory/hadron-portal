import { z } from 'zod';

export const deleteOrgAppSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteApp').default('deleteApp'),
  id: z.string().trim().min(1, 'App ID is required').prefault(''),
});
