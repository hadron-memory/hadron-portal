import { z } from 'zod';
import { t } from '$lib/i18n/t';
import { urnSlugField } from '$lib/forms/zod-validators';

export const installAgentSchema = z.object({
  _kind: z.literal('installAgent').default('installAgent'),
  name: z.string().trim().min(1, 'Name is required.').prefault(''),
  urn: urnSlugField('App URN slug', 'URN is required.').prefault(''),
  appType: z.enum(['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT']).prefault('WORKSTATION'),
});

export const installExistingAppSchema = z.object({
  _kind: z.literal('installExistingApp').default('installExistingApp'),
  appId: z.string().trim().min(1, t('install.existing.required', 'Choose an App.')),
});
