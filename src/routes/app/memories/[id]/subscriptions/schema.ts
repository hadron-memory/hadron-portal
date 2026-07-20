import { z } from 'zod';

export const memorySubscriptionRoles = ['READER', 'CONTRIBUTOR'] as const;

export const memorySubscriptionSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('subscribeMemory').default('subscribeMemory'),
  orgId: z.string().trim().min(1, 'Organization ID is required.').prefault(''),
  role: z.preprocess((value) => {
    const role = String(value ?? '').trim();
    // Preserve legacy behavior from #266: absent or tampered roles subscribe as READER.
    return (memorySubscriptionRoles as readonly string[]).includes(role) ? role : 'READER';
  }, z.enum(memorySubscriptionRoles)),
});

export const memoryUnsubscribeSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('unsubscribeMemory').default('unsubscribeMemory'),
  orgId: z.string().trim().min(1, 'Organization ID is required.').prefault(''),
});

export type MemorySubscriptionSchema = typeof memorySubscriptionSchema;
export type MemoryUnsubscribeSchema = typeof memoryUnsubscribeSchema;
