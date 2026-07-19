import { z } from 'zod';
import { parseConditionField, parsePriorityField } from './edge-form';

// Conversation routing-rule panel schema. It composes the shared flow-domain
// parsers so validation stays aligned with addEdge and the edge editor.
export const conversationEdgePanelSchema = z.object({
  edgeId: z.string().trim().min(1, 'Missing edge id').prefault(''),
  name: z.string().trim().default(''),
  priority: z.preprocess(
    (value) => String(value ?? '').trim(),
    z.string().superRefine((value, ctx) => {
      const parsed = parsePriorityField(value);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error });
    }),
  ).default(''),
  condition: z.string().default('null').superRefine((value, ctx) => {
    const parsed = parseConditionField(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error });
  }),
  data: z.string().default('{}').superRefine((value, ctx) => {
    try {
      JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
    }
  }),
});

export type ConversationEdgePanelSchema = typeof conversationEdgePanelSchema;

export function conversationEdgePanelDefaults(edge: {
  id: string;
  name: string | null;
  priority: number | null;
  condition: unknown;
  data: Record<string, unknown>;
  timing: string | null;
  behavior: string | null;
}) {
  return {
    edgeId: edge.id,
    name: edge.name ?? '',
    priority: String(edge.priority ?? 0),
    condition: JSON.stringify(edge.condition ?? null),
    data: JSON.stringify({
      ...edge.data,
      timing: edge.timing ?? 'on_complete',
      behavior: edge.behavior ?? 'transition',
    }),
  };
}

export function parseValidatedConversationEdgeData(value: string): unknown {
  return JSON.parse(value);
}
