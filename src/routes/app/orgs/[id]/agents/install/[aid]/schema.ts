import { z } from 'zod';
import { urnSlugField } from '$lib/forms/zod-validators';

export const installAgentSchema = z.object({
  _kind: z.literal('installAgent').default('installAgent'),
  name: z.string().trim().min(1, 'Name is required.').prefault(''),
  urn: urnSlugField('App URN slug', 'URN is required.').prefault(''),
  appType: z.enum(['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT']).prefault('WORKSTATION'),
});
