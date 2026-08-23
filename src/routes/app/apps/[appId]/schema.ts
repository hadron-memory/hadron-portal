import { z } from 'zod';

const agentToolsField = z.preprocess(
  (value) => value === undefined ? [] : (Array.isArray(value) ? value : [value]),
  z.array(z.string().trim().min(1)),
);

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

export const removeAppAgentSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('removeAgent').default('removeAgent'),
  agentId: z.string().trim().min(1, 'Agent is required').prefault(''),
});

export const updateAppAgentToolsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateAgentTools').default('updateAgentTools'),
  agentTools: agentToolsField.prefault([]),
});

export const revokeAppKeySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('revokeKey').default('revokeKey'),
  keyId: z.string().trim().min(1, 'Key is required').prefault(''),
});

export const deleteAppSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteApp').default('deleteApp'),
});

// ── Casting (#974, #760) ──────────────────────────────────────────────────
//
// Casting an INSTALLED agent into this App under a name creates a Worker: the
// App's staff.
//
// `name` is REQUIRED (#760). It was optional until hadron-server#1050 removed
// the cast-list register: an omitted name used to walk the Team Agent's
// register for the next free one, and the server now refuses a nameless cast
// with WORKER_NAME_REQUIRED. Leaving it optional here does not make the cast
// work — it makes the form recommend a request the server rejects, which is
// exactly what #760 reports.
//
// `role` stays optional and must still reach the mutation as UNDEFINED rather
// than '': an omitted role inherits the agent's personaRole, while an empty
// string would be an explicit (invalid) role. That distinction is unchanged.
export const castWorkerSchema = z.object({
  _kind: z.literal('castWorker').default('castWorker'),
  agentId: z.string().trim().min(1, 'Select an agent to cast.').prefault(''),
  name: z.string().trim().min(1, 'Give the worker a name — the platform no longer picks one.').prefault(''),
  role: z.string().trim().optional(),
  promptOverride: z.string().trim().optional(),
});

export const retireWorkerSchema = z.object({
  _kind: z.literal('retireWorker').default('retireWorker'),
  workerId: z.string().trim().min(1, 'Worker is required').prefault(''),
});

// Posting to the App's TEAM CHAT (hadron-portal#732) is defined in $lib/forms
// so the route action and TeamChatThread.svelte share one definition.
export { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
