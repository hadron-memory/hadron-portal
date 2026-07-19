import { z } from 'zod';
import { cleanLocInput } from '$lib/urn/clean-loc-input';

function normalizedLoc(value: string, ctx: z.RefinementCtx): string {
  if (!value) return '';
  try {
    return cleanLocInput(value);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid loc.',
    });
    return z.NEVER as never;
  }
}

const seqField = z.preprocess((value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}, z.number().int().nullable()).default(null);

export const editNodeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').prefault(''),
  loc: z.string().trim().default('').transform(normalizedLoc),
  description: z.string().trim().default(''),
  alias: z.string().trim().default(''),
  abstract: z.string().trim().default(''),
  content: z.string().trim().default(''),
  seq: seqField,
  tags: z.string().trim().default(''),
  isRunnable: z.preprocess((value) => value === true || value === 'true' || value === 'on', z.boolean()).default(false),
  edges: z.string().default(''),
});

export type EditNodeSchema = typeof editNodeSchema;
