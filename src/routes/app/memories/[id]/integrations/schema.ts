import { z } from 'zod';

export const memoryIntegrationSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateIntegration').default('updateIntegration'),
  source: z.string().trim().default(''),
  readBranch: z.string().trim().default(''),
  writeBranch: z.string().trim().default(''),
});

export const syncMemoryIntegrationSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('syncMemory').default('syncMemory'),
});

export const pushMemoryIntegrationSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('pushMemory').default('pushMemory'),
});

export type MemoryIntegrationSchema = typeof memoryIntegrationSchema;
export type SyncMemoryIntegrationSchema = typeof syncMemoryIntegrationSchema;
export type PushMemoryIntegrationSchema = typeof pushMemoryIntegrationSchema;
