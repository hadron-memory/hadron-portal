import { z } from 'zod';

export const mergeNodeFields = ['CONTENT', 'ABSTRACT', 'DESCRIPTION', 'TAGS', 'DATA', 'PROPERTIES', 'EDGES'] as const;

const mergeField = z.enum(mergeNodeFields);
const boolCheckbox = z.preprocess((value) => value === true || value === 'true', z.boolean());
const includeField = z.preprocess(
  (value) => value === undefined ? [] : (Array.isArray(value) ? value : [value]),
  z.array(mergeField),
);

export const mergeNodeSchema = z.object({
  _kind: z.literal('mergeNode').default('mergeNode'),
  source: z.string().trim().min(1, 'Enter a source node.').prefault(''),
  target: z.string().trim().min(1, 'Enter a target node.').prefault(''),
  include: includeField.prefault([]),
  deleteSource: boolCheckbox.prefault(false),
});
