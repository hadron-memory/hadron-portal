import { z } from 'zod';
import { parseDisplayUrn } from '$lib/urn/parse-urn';
import { validateOrgSlugField } from '$lib/urn/form-validation';

export const orgProfileSchema = z
  .object({
    name: z.string().trim().default(''),
    urn: z.string().trim().default(''),
  })
  .superRefine((data, ctx) => {
    if (!data.urn) return;
    let slug: string;
    try {
      slug = parseDisplayUrn(data.urn, 'org').bareValue;
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['urn'],
        message: 'Invalid organization URN.',
      });
      return;
    }
    const error = validateOrgSlugField(slug);
    if (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['urn'],
        message: error,
      });
    }
  });

export type OrgProfileSchema = typeof orgProfileSchema;
