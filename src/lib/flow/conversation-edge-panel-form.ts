import { z } from 'zod';
import { flowEdgePanelDefaults, flowEdgePanelSchema } from './edge-panel-form';

const dataField = z.string().default('{}').superRefine((value, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    ctx.addIssue({ code: 'custom', message: 'Data must be a JSON object' });
  }
});

// Conversation routing-rule panel schema lives with the flow helpers because it
// extends the shared edge panel fields and adds conversation-specific edge data.
export const conversationEdgePanelSchema = flowEdgePanelSchema.extend({ data: dataField });

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
    ...flowEdgePanelDefaults(edge),
    data: JSON.stringify({
      ...edge.data,
      timing: edge.timing ?? 'on_complete',
      behavior: edge.behavior ?? 'transition',
    }),
  };
}

export function parseValidatedConversationEdgeData(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    throw new Error(
      `Validated conversation edge data failed to parse: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error('Validated conversation edge data was not a JSON object');
}
