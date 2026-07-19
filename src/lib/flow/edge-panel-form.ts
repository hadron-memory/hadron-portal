import { z } from 'zod';
import { parseConditionField, parsePriorityField } from './edge-form';

// Shared with the flow-canvas side panel because it composes the flow domain
// parsers here; duplicating it route-locally would drift from these helpers.
export const flowEdgePanelSchema = z.object({
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
});

export type FlowEdgePanelSchema = typeof flowEdgePanelSchema;

export function flowEdgePanelDefaults(edge: {
  id: string;
  name: string | null;
  priority: number | null;
  condition: unknown;
}) {
  return {
    edgeId: edge.id,
    name: edge.name ?? '',
    priority: String(edge.priority ?? 0),
    condition: JSON.stringify(edge.condition ?? null),
  };
}

export function parseValidatedPanelPriority(value: string): number {
  const parsed = parsePriorityField(value);
  if (parsed.ok) return parsed.value;
  throw new Error(`Validated priority failed to parse: ${parsed.error}`);
}

export function parseValidatedPanelCondition(value: string): unknown {
  const parsed = parseConditionField(value);
  if (parsed.ok) return parsed.value;
  throw new Error(`Validated condition failed to parse: ${parsed.error}`);
}
