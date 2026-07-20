import { z } from 'zod';

export const orgMemberRoleSchema = z.enum(['READER', 'CONTRIBUTOR', 'ADMIN', 'OWNER']);

export const addOrgMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addOrgMember').default('addOrgMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
  role: orgMemberRoleSchema.prefault('READER'),
});

export const updateOrgMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateOrgMember').default('updateOrgMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
  role: orgMemberRoleSchema.prefault('READER'),
});

export const removeOrgMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('removeOrgMember').default('removeOrgMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
});

export const leaveOrgSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('leaveOrg').default('leaveOrg'),
});

export const inviteMemberSchema = z
  .object({
    // Defaulted _kind accepts omitted hidden inputs while still rejecting a
    // defined discriminator from the wrong action.
    _kind: z.literal('inviteOrgMember').default('inviteOrgMember'),
    name: z.string().trim().default(''),
    email: z
      .string()
      .trim()
      .default('')
      .refine((email) => email === '' || z.string().email().safeParse(email).success, {
        message: 'Enter a valid email address.',
      }),
    memberRole: orgMemberRoleSchema.default('READER'),
  })
  .superRefine((data, ctx) => {
    if (data.name || data.email) return;
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: 'Enter a name or email address.',
    });
  });

export type AddOrgMemberSchema = typeof addOrgMemberSchema;
export type UpdateOrgMemberSchema = typeof updateOrgMemberSchema;
export type RemoveOrgMemberSchema = typeof removeOrgMemberSchema;
export type LeaveOrgSchema = typeof leaveOrgSchema;
export type InviteMemberSchema = typeof inviteMemberSchema;
