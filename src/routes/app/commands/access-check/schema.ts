import { z } from 'zod';

export const accessCheckSchema = z.object({
  _kind: z.literal('accessCheck').default('accessCheck'),
  user: z.string().trim().min(1, 'Enter a user.').prefault(''),
  resource: z.string().trim().min(1, 'Enter a resource.').prefault(''),
});
