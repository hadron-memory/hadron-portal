import { z } from 'zod';
import { urnSlugField } from '$lib/forms/zod-validators';

// #648: org-less (personal) app create. Unlike the org install route — where the
// agent is a path param — the agent is chosen here (own personal ∪ PUBLIC), so
// the form carries agentId alongside the name/urn/appType the org install form
// already collects.
export const createPersonalAppSchema = z.object({
  _kind: z.literal('createPersonalApp').default('createPersonalApp'),
  agentId: z.string().trim().min(1, 'Choose an agent to install.').prefault(''),
  name: z.string().trim().min(1, 'Name is required.').prefault(''),
  urn: urnSlugField('App URN slug', 'URN is required.').prefault(''),
  appType: z.enum(['WORKSTATION', 'CHATBOT', 'AGENT', 'AUTOMATION', 'CLOUD', 'IOT']).prefault('WORKSTATION'),
});
