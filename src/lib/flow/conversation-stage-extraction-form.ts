import { z } from 'zod';

// Conversation stage extraction-spec schema lives with the flow helpers because
// the reusable stage panel lives under $lib/components/flow.
const extractionSpecField = z.string().default('[]').superRefine((value, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
    return;
  }
  if (!Array.isArray(parsed)) {
    ctx.addIssue({ code: 'custom', message: 'Extraction spec must be a JSON array' });
  }
});

export const conversationStageExtractionSchema = z.object({
  _kind: z.literal('updateExtractionSpec').default('updateExtractionSpec'),
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  stageLoc: z.string().trim().min(1, 'Missing stage loc').prefault(''),
  extractionSpec: extractionSpecField,
});

export type ConversationStageExtractionSchema = typeof conversationStageExtractionSchema;

export function conversationStageExtractionDefaults(stage: {
  loc: string;
  extractionSpec: unknown[];
}, systemMemoryId: string) {
  return {
    _kind: 'updateExtractionSpec' as const,
    systemMemoryId,
    stageLoc: stage.loc,
    extractionSpec: JSON.stringify(stage.extractionSpec, null, 2),
  };
}

export function parseValidatedExtractionSpec(value: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    throw new Error(`Validated extraction spec failed to parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (Array.isArray(parsed)) return parsed;
  throw new Error('Validated extraction spec was not a JSON array');
}
