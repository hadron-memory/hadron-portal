import { z } from 'zod';

export const addAppMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addAppMember').default('addAppMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
  role: z.string().trim().min(1, 'Role is required.').prefault(''),
});

export const ensureAppMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('ensureAppMember').default('ensureAppMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
  role: z.string().trim().min(1, 'Role is required.').prefault(''),
});

export const removeAppMemberSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('removeAppMember').default('removeAppMember'),
  userId: z.string().trim().min(1, 'User is required.').prefault(''),
});

export type AddAppMemberSchema = typeof addAppMemberSchema;
export type EnsureAppMemberSchema = typeof ensureAppMemberSchema;
export type RemoveAppMemberSchema = typeof removeAppMemberSchema;
