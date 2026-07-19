import { z } from 'zod';

export const mergeMemoryFields = ['CONTENT', 'ABSTRACT', 'DESCRIPTION', 'TAGS', 'DATA', 'PROPERTIES', 'EDGES'] as const;

const mergeField = z.enum(mergeMemoryFields);
const boolCheckbox = z.preprocess((value) => value === true || value === 'true', z.boolean());
const includeField = z.preprocess(
  (value) => value === undefined ? [] : (Array.isArray(value) ? value : [value]),
  z.array(mergeField),
);

export const mergeMemorySchema = z.object({
  _kind: z.literal('mergeMemory').default('mergeMemory'),
  source: z.string().trim().min(1, 'Enter a source memory.').prefault(''),
  target: z.string().trim().min(1, 'Enter a target memory.').prefault(''),
  include: includeField.prefault([]),
  deleteSourceMem: boolCheckbox.prefault(false),
});
