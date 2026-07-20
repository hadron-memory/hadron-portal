import { z } from 'zod';
import { parseConditionField, parsePriorityField } from '$lib/flow/edge-form';

export const EDGE_DATA_MAX = 262144; // 256 KB

const priorityField = z.preprocess(
  (value) => String(value ?? '').trim(),
  z.string().superRefine((value, ctx) => {
    const parsed = parsePriorityField(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error });
  }),
).default('');

// JSON null is the meaningful default here: omitted condition preserves the
// pre-migration "always fires / clear condition" behavior. This is not a
// required text field placeholder.
const conditionField = z.string().default('null').superRefine((value, ctx) => {
  const parsed = parseConditionField(value);
  if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error });
});

export function parseEdgeDataText(value: string): unknown {
  const trimmed = value.trim();
  return trimmed === '' ? null : JSON.parse(trimmed);
}

const dataField = z.string().default('').superRefine((value, ctx) => {
  const trimmed = value.trim();
  if (trimmed === '') return;
  if (trimmed.length > EDGE_DATA_MAX) {
    ctx.addIssue({ code: 'custom', message: `JSON too large (max ${EDGE_DATA_MAX / 1024} KB)` });
    return;
  }
  try {
    parseEdgeDataText(trimmed);
  } catch (e) {
    ctx.addIssue({
      code: 'custom',
      message: e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON',
    });
  }
});

export const edgeUpdateSchema = z.object({
  _kind: z.literal('updateEdge').default('updateEdge'),
  name: z.string().trim().default(''),
  description: z.string().trim().default(''),
  isRunnable: z.preprocess((value) => value === true || value === 'true' || value === 'on', z.boolean()).default(false),
  priority: priorityField,
  condition: conditionField,
  data: dataField,
});

export const edgeDeleteSchema = z.object({
  _kind: z.literal('deleteEdge').default('deleteEdge'),
});

export type EdgeUpdateSchema = typeof edgeUpdateSchema;
export type EdgeDeleteSchema = typeof edgeDeleteSchema;
