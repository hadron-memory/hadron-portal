import { z } from 'zod/v4';
export const ruleInput = z.object({
  role: z.string().min(1).max(64), enabled: z.boolean().optional(), strictSubRoles: z.boolean().optional(),
  writers: z.enum(['ALL', 'ADMIN', 'OWNER']).optional(), validateBy: z.enum(['AGENT', 'PLATFORM']).nullable().optional(),
  authorTaskRef: z.string().nullable().optional(), validationTaskRef: z.string().nullable().optional(), descriptionNodeRef: z.string().nullable().optional(),
}).strict();
export const templateInput = z.object({ name: z.string().min(1).max(64), description: z.string().nullable().optional(), required: z.boolean(), rules: z.array(ruleInput).max(200).optional() }).strict();
export const configRequest = z.object({
  kind: z.enum(['rules', 'templates', 'apply', 'bulk']), op: z.enum(['read', 'create', 'update', 'delete', 'unlock', 'preview', 'apply']),
  memoryRef: z.string().min(1).optional(), memoryRefs: z.array(z.string()).optional(), ref: z.string().min(1).optional(), revision: z.number().int().positive().optional(),
  ownerType: z.enum(['USER', 'ORGANIZATION', 'APP']).optional(), ownerRef: z.string().min(1).optional(), input: z.unknown().optional(),
}).strict();
