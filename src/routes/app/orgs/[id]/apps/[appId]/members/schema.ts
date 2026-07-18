import { z } from 'zod';

export const addAppMemberSchema = z.object({
  userId: z.string().trim().min(1, 'User is required.'),
  role: z.string().trim().min(1, 'Role is required.'),
});

export type AddAppMemberSchema = typeof addAppMemberSchema;
