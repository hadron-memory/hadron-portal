import { z } from 'zod';

const checkboxBoolean = z.preprocess(
  (value) => value === true || value === 'true' || value === 'on',
  z.boolean(),
).default(false);

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeMoveSchema = z.object({
  _kind: z.literal('moveNode').default('moveNode'),
  target: z.string().trim().min(1, 'Enter a destination node URN.').prefault(''),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeTestFlowSchema = z.object({
  _kind: z.literal('testFlow').default('testFlow'),
  appId: z.string().trim().min(1, 'Pick an App to run as.').prefault(''),
  orgId: z.string().trim().min(1, 'Missing organization.').prefault(''),
  payload: z.string().trim().default('').superRefine((value, ctx) => {
    if (value === '') return;
    try {
      const parsed = JSON.parse(value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ctx.addIssue({ code: 'custom', message: 'The test payload must be a JSON object of named fields.' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'The test payload must be valid JSON.' });
    }
  }),
});

// Defaulted _kind accepts omitted hidden inputs while still rejecting a
// defined discriminator from the wrong action.
export const nodeDeleteSchema = z.object({
  _kind: z.literal('deleteNode').default('deleteNode'),
  hard: checkboxBoolean,
});

export type NodeMoveSchema = typeof nodeMoveSchema;
export type NodeTestFlowSchema = typeof nodeTestFlowSchema;
export type NodeDeleteSchema = typeof nodeDeleteSchema;
