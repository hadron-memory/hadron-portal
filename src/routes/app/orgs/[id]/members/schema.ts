import { z } from 'zod';

export const memberRoleSchema = z.enum(['READER', 'CONTRIBUTOR', 'ADMIN', 'OWNER']).default('READER');

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
    memberRole: memberRoleSchema,
  })
  .superRefine((data, ctx) => {
    if (data.name || data.email) return;
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'Enter a name or email address.',
    });
  });

export type InviteMemberSchema = typeof inviteMemberSchema;
