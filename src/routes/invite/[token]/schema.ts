import { z } from 'zod';

export const inviteEmailSchema = z.object({
  _kind: z.literal('sendEmail').default('sendEmail'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.')
    .prefault(''),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a defined
// discriminator from the wrong action.
export const acceptInvitationSchema = z.object({
  _kind: z.literal('acceptInvitation').default('acceptInvitation'),
});

export type InviteEmailSchema = typeof inviteEmailSchema;
export type AcceptInvitationSchema = typeof acceptInvitationSchema;
