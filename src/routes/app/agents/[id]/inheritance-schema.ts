import { z } from 'zod';
import { t } from '$lib/i18n/t';
export const agentBaseSchema = z.object({
  _kind: z.literal('setAgentBase'),
  operation: z.enum(['set', 'clear']),
  baseRef: z.string().trim(),
}).superRefine((value, ctx) => {
  if (value.operation === 'set' && !value.baseRef) ctx.addIssue({ code: 'custom', path: ['baseRef'], message: t('agent.inheritance.base-required', 'Enter a base Agent reference.') });
});
export const agentIndexRefsSchema = z.object({
  _kind: z.literal('setAgentIndexRefs'),
  tasksOperation: z.enum(['keep', 'set', 'clear']),
  tasksIndexRef: z.string().trim(),
  processesOperation: z.enum(['keep', 'set', 'clear']),
  processesIndexRef: z.string().trim(),
}).superRefine((value, ctx) => {
  if (value.tasksOperation === 'set' && !value.tasksIndexRef) ctx.addIssue({ code: 'custom', path: ['tasksIndexRef'], message: t('agent.inheritance.tasks-required', 'Enter a tasks index reference.') });
  if (value.processesOperation === 'set' && !value.processesIndexRef) ctx.addIssue({ code: 'custom', path: ['processesIndexRef'], message: t('agent.inheritance.processes-required', 'Enter a processes index reference.') });
});
