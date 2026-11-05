// portal#1551: real component and native browser keys; only loader facts/Kit
// context and the paged HTTP response are synthetic. No authenticated writes.
import { mount } from 'svelte';
import TaskPlanning from '$lib/components/agent-tasks/TaskPlanning.svelte';
const choice = (id: string) => ({ id, appId: 'app', title: `Task ${id}`, handle: `AT1.${id}`, status: 'PENDING' });
export function mountRelationFocus(target: HTMLElement) {
  return mount(TaskPlanning as never, { target, props: {
    task: { id: 'task', appId: 'app', handle: 'AT1', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: false,
    dependencies: { kind: 'ok', value: {
      blockedBy: { items: Array.from({ length: 200 }, (_, i) => choice(`old-wait-${i}`)), hasMore: true },
      blocks: { items: Array.from({ length: 200 }, (_, i) => choice(`old-hold-${i}`)), hasMore: true },
    } },
  } as never });
}
