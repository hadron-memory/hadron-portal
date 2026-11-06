// Browser-only fixture: real components/CSS, synthetic owner data and controlled refusal.
import { mount } from 'svelte';
import TemplatesManager from '$lib/components/memory-config/TemplatesManager.svelte';
const rule = { role: 'review', enabled: true, strictSubRoles: true, writers: 'ADMIN', validateBy: 'AGENT', authorTask: null, authorTaskState: 'NONE', validationTask: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeState: 'NONE' };
export function mountTemplates(target: HTMLElement) {
  return mount(TemplatesManager, { target, props: { initial: [{ id: 't', name: 'Baseline', description: 'Fixture template', required: true, revision: 1, rules: Array.from({ length: 25 }, (_, i) => ({ ...rule, role: `review${String(i).padStart(2, '0')}` })) }], ownerType: 'USER', ownerRef: 'u', canManage: true, readOnly: false, memories: [], memoriesFailed: false } as never });
}
