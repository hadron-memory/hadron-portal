import { z } from 'zod';
import { jsonObjectField } from '$lib/forms/zod-validators';
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
  // #588 (server #725): collection discriminator — a declared collection name
  // (picker) or free text on a schema-less memory. Empty = ordinary node.
  // The server validates the value; the schema's name grammar isn't mirrored
  // here so a free-form value on an unstructured memory stays unrestricted.
  objectType: z.string().trim().default(''),
  // #588: the typed properties record, round-tripped as one serialized JSON
  // string (PropertiesEditor writes it; a hidden input submits it).
  propertiesJson: jsonObjectField('Properties'),
});

export type CreateNodeSchema = typeof createNodeSchema;
