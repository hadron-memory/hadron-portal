import { z } from 'zod';

export const appSettingsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateApp').default('updateApp'),
  name: z.string().trim().min(1, 'Name is required').prefault(''),
  urn: z.string().trim().min(1, 'URN slug is required').prefault(''),
  appType: z.enum(['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT']).prefault('WORKSTATION'),
  role: z.enum(['OWNER', 'ADMIN', 'CONTRIBUTOR', 'READER']).prefault('READER'),
  description: z.string().trim().default(''),
  systemPrompt: z.string().trim().default(''),
  createUserPermission: z.enum(['DENY', 'EXPLICIT', 'IMPLICIT']).prefault('DENY'),
  identifyUserMethod: z.enum(['USER_ID', 'SECRET']).prefault('USER_ID'),
  sessionTimeoutSeconds: z.string()
    .trim()
    .regex(/^\d+$/, 'Session timeout must be a whole number')
    .refine((value) => Number(value) >= 60, 'Session timeout must be at least 60 seconds')
    .refine((value) => Number(value) <= 86400, 'Session timeout must be at most 86400 seconds')
    .prefault(''),
  anonymousTtlDays: z.string()
    .trim()
    .regex(/^\d+$/, 'Anonymous TTL must be a whole number')
    .refine((value) => Number(value) >= 1, 'Anonymous TTL must be at least 1 day')
    .refine((value) => Number(value) <= 90, 'Anonymous TTL must be at most 90 days')
    .prefault(''),
});

export const addAgentSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addAgent').default('addAgent'),
  agentId: z.string().trim().min(1, 'Agent is required').prefault(''),
  trainingMode: z.enum(['true', 'false']).optional(),
});

export const createAppKeySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('createKey').default('createKey'),
  label: z.string().trim().default(''),
});
