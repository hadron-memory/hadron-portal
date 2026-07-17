import { z } from 'zod';
import { optionalHttpUrl } from '$lib/forms/zod-validators';
import { toBareMemorySlugInput, validateMemorySlugField } from '$lib/urn/form-validation';

export const memorySettingsSchema = z
  .object({
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

export type MemorySettingsSchema = typeof memorySettingsSchema;
