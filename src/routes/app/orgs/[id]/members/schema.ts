import { z } from 'zod';

export const inviteMemberSchema = z
  .object({
    name: z.string().trim().default(''),
    email: z
      .string()
      .trim()
      .default('')
      .refine((email) => email === '' || z.string().email().safeParse(email).success, {
        message: 'Enter a valid email address.',
      }),
    memberRole: z.enum(['READER', 'CONTRIBUTOR', 'ADMIN', 'OWNER']).default('READER'),
  })
  .superRefine((data, ctx) => {
    if (data.name || data.email) return;
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: 'Enter a name or email address.',
    });
  });

export type InviteMemberSchema = typeof inviteMemberSchema;
