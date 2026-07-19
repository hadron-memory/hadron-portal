import { z } from 'zod';

import { parseConditionField, parsePriorityField } from '$lib/flow/edge-form';

// Defaulted _kind accepts omitted hidden inputs while still rejecting a defined
// discriminator from the wrong action.
export const addConversationSchema = z.object({
  _kind: z.literal('addConversation').default('addConversation'),
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  name: z.string().trim().min(1, 'Name is required').prefault(''),
});

export type AddConversationSchema = typeof addConversationSchema;

// Defaulted _kind accepts omitted hidden inputs while still rejecting a defined
// discriminator from the wrong action.
export const addEdgeSchema = z.object({
  _kind: z.literal('addEdge').default('addEdge'),
  sourceNodeId: z.string().trim().min(1, 'Source is required').prefault(''),
  targetNodeId: z.string().trim().min(1, 'Target is required').prefault(''),
  name: z.string().default(''),
  condition: z.string().default('null'),
  priority: z.string().prefault('0'),
  data: z.string().default('{}'),
}).superRefine((data, ctx) => {
  const condition = parseConditionField(data.condition);
  if (!condition.ok) {
    ctx.addIssue({ code: 'custom', path: ['condition'], message: condition.error });
  }

  const priority = parsePriorityField(data.priority);
  if (!priority.ok) {
    ctx.addIssue({ code: 'custom', path: ['priority'], message: priority.error });
  }

  try {
    const parsedData = JSON.parse(data.data);
    if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
      ctx.addIssue({ code: 'custom', path: ['data'], message: 'Edge data must be a JSON object' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', path: ['data'], message: 'Invalid JSON in edge data' });
  }
});

export type AddEdgeSchema = typeof addEdgeSchema;
