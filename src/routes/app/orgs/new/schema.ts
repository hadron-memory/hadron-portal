import { z } from 'zod';
import { orgSlugField } from '$lib/forms/zod-validators';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  urn: orgSlugField(),
});

export type CreateOrganizationSchema = typeof createOrganizationSchema;
