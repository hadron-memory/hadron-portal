// Browser-only fixture: real components/CSS, synthetic owner data and controlled refusal.
import { mount } from 'svelte';
import RulebookManager from '$lib/components/memory-config/RulebookManager.svelte';
import TemplatesManager from '$lib/components/memory-config/TemplatesManager.svelte';
const rule = { role: 'review', enabled: true, strictSubRoles: true, writers: 'ADMIN', validateBy: 'AGENT', authorTask: null, authorTaskState: 'NONE', validationTask: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeState: 'NONE' };
export function mountTemplates(target: HTMLElement) {
  return mount(TemplatesManager, { target, props: { initial: [{ id: 't', name: 'Baseline', description: 'Fixture template', required: true, revision: 1, rules: Array.from({ length: 25 }, (_, i) => ({ ...rule, role: `review${String(i).padStart(2, '0')}` })) }], ownerType: 'USER', ownerRef: 'u', canManage: true, readOnly: false, memories: [], memoriesFailed: false } as never });
}

const bulkMemories = (length: number) => Array.from({ length }, (_, i) => ({ id: `m${i}`, name: i === 5 ? 'A memory with quite a long name that has to wrap on a phone screen' : `Fixture memory ${i}`, urn: `hrn:mem:acme.example:fixture-memory-with-a-long-slug-${i}` }));
export function mountBulkTemplates(target: HTMLElement, required = false, count = 6) {
  return mount(TemplatesManager, { target, props: { initial: [{ id: 't', name: 'Baseline', description: 'Fixture template', required, revision: 1, rules: [] }], ownerType: 'ORGANIZATION', ownerRef: 'o', canManage: true, readOnly: false, memories: bulkMemories(count), memoriesFailed: false } as never });
}

export function mountRulebook(target: HTMLElement) {
  return mount(RulebookManager, { target, props: { initial: { id: 'config', rules: [{ ...rule, id: 'r', revision: 1, locked: false }] }, memoryRef: 'm', readOnly: false, memories: [], memoriesFailed: false } as never });
}
