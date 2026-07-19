import { z } from 'zod';
import { createNodeStrings } from '$lib/i18n/create-node-strings';
import { cleanLocInput } from '$lib/urn/clean-loc-input';

export const createNodeTypes = ['info', 'record', 'system', 'reference'] as const;

export const createNodeSchema = z.object({
  name: z.string().trim().min(1, createNodeStrings.errorNameRequired()).prefault(''),
  loc: z.string().trim().prefault('').superRefine((value, ctx) => {
    let loc = '';
    try {
      loc = cleanLocInput(value);
    } catch {
      loc = '';
    }
    if (!loc) {
      ctx.addIssue({
        code: 'custom',
        message: createNodeStrings.errorLocRequired(),
      });
    }
  }),
  nodeType: z.enum(createNodeTypes).default('info'),
  description: z.string().trim().default(''),
  abstract: z.string().trim().default(''),
  content: z.string().trim().default(''),
});

export type CreateNodeSchema = typeof createNodeSchema;
