import { z } from 'zod';
import { optionalHttpUrl } from '$lib/forms/zod-validators';
import { toBareMemorySlugInput, validateMemorySlugField } from '$lib/urn/form-validation';

const booleanString = z
  .union([
    z.boolean(),
    z.string().trim().pipe(z.enum(['true', 'false'])),
  ])
  .transform((value) => value === true || value === 'true');

export const memorySettingsSchema = z
  .object({
    // Defaulted _kind accepts omitted hidden inputs while still rejecting a
    // defined discriminator from the wrong action.
    _kind: z.literal('updateMemorySettings').default('updateMemorySettings'),
    displayName: z.string().trim().default(''),
    urnSlug: z.string().trim().default(''),
    urnSlugPresent: z.string().trim().default(''),
    originalUrnSlug: z.string().trim().default(''),
    currentUrn: z.string().trim().default(''),
    organizationId: z.string().trim().default(''),
    currentOrganizationId: z.string().trim().default(''),
    shortDescription: z.string().trim().default(''),
    description: z.string().trim().default(''),
    tags: z.string().trim().default(''),
    category0: z.string().trim().default(''),
    category1: z.string().trim().default(''),
    category2: z.string().trim().default(''),
    license: z.string().trim().default(''),
    homeUrl: optionalHttpUrl.default(''),
    iconUrl: optionalHttpUrl.default(''),
    heroUrl: optionalHttpUrl.default(''),
    visibility: z.enum(['ORGANIZATION', 'PUBLIC']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.urnSlugPresent !== 'true') return;

    const bareSlug = toBareMemorySlugInput(data.urnSlug);
    if (!bareSlug) {
      ctx.addIssue({
        code: 'custom',
        path: ['urnSlug'],
        message: 'URN slug cannot be empty.',
      });
      return;
    }

    const error = validateMemorySlugField(bareSlug);
    if (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['urnSlug'],
        message: error,
      });
    }
  });

export const vectorIndexSettingsSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateVectorIndex').default('updateVectorIndex'),
  vectorIndexEnabled: booleanString.default(false),
  embeddingSource: z.enum(['abstract', 'contentChunks', 'both']).default('abstract'),
  chunkTokens: z.string().trim().default(''),
  chunkOverlap: z.string().trim().default(''),
  forceFixedSize: booleanString.default(false),
  acknowledgeVectorInversionRisk: booleanString.default(false),
});

export const deleteMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteMemory').default('deleteMemory'),
  organizationId: z.string().trim().default(''),
});

export type MemorySettingsSchema = typeof memorySettingsSchema;
export type VectorIndexSettingsSchema = typeof vectorIndexSettingsSchema;
export type DeleteMemorySchema = typeof deleteMemorySchema;
