import { z } from 'zod';
import { checkboxBoolean } from '$lib/forms/checkbox-boolean';

export const mergeMemoryFields = ['CONTENT', 'ABSTRACT', 'DESCRIPTION', 'TAGS', 'DATA', 'PROPERTIES', 'EDGES'] as const;

const mergeField = z.enum(mergeMemoryFields);
const includeField = z.preprocess(
  (value) => value === undefined ? [] : (Array.isArray(value) ? value : [value]),
  z.array(mergeField),
);

export const mergeMemorySchema = z.object({
  _kind: z.literal('mergeMemory').default('mergeMemory'),
  source: z.string().trim().min(1, 'Enter a source memory.').prefault(''),
  target: z.string().trim().min(1, 'Enter a target memory.').prefault(''),
  include: includeField.prefault([]),
  deleteSourceMem: checkboxBoolean.prefault(false),
});
