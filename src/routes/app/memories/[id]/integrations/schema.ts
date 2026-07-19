import { z } from 'zod';

export const memoryIntegrationSchema = z.object({
  source: z.string().trim().default(''),
  readBranch: z.string().trim().default(''),
  writeBranch: z.string().trim().default(''),
});

export type MemoryIntegrationSchema = typeof memoryIntegrationSchema;
