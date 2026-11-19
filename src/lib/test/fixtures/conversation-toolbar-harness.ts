// #2092: real Conversation Editor, synthetic data and browser-recorder forms.
// No server writes; the independent QA seat exercises the authenticated route.
import { flushSync, mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from '../../../routes/app/agents/[id]/conversations/+page.svelte';
import { addConversationSchema, addEdgeSchema } from '../../../routes/app/agents/[id]/conversations/schema';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhanced } from '$lib/test/stubs/app-forms';

export async function mountConversationToolbar(target: HTMLElement, error = false) {
  setStubPage('http://localhost/app/agents/agent-fixture/conversations', { id: 'agent-fixture' });
  const addConversationForm = await superValidate({ systemMemoryId: 'memory-fixture', name: '' }, zod4(addConversationSchema), { errors: false });
  if (error) addConversationForm.message = { type: 'error', text: 'Could not add this conversation. Refresh before trying again.' };
  const data = {
    agent: { id: 'agent-fixture', name: 'Toolbar fixture', organizationId: 'org-fixture' },
    org: { id: 'org-fixture', name: 'Synthetic organization' },
    systemMemoryId: 'memory-fixture', prompts: [], systemNodes: [],
    addConversationForm,
    addEdgeForm: await superValidate({ sourceNodeId: '', targetNodeId: '', name: '', condition: 'null', priority: '0', data: '{}' }, zod4(addEdgeSchema), { errors: false }),
    addStageForms: {}, promptForms: {}, edgeForms: {}, stageExtractionForms: {}, conversationGoalForms: {}, conversationStartForms: {},
  };
  const instance = mount(Page as never, { target, props: { data, form: null } as never });
  flushSync();
  return () => unmount(instance);
}

export async function conversationSubmitValues(form: HTMLFormElement) {
  const result = await submitEnhanced(form, true);
  return { cancelled: result.cancelled, values: Object.fromEntries(result.formData.entries()) };
}
