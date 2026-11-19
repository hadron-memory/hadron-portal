// portal#1619: mounts the real TaskIntegrations section for scripts/test-task-integrations-focus.mjs.
// Loaded through Vite so `$lib`, `$app/*` and the component's own Svelte compile apply. Real
// Chromium is the point: jsdom computes no Tailwind cascade, so it cannot see `outline-none`
// beating `focus-visible:outline-2`.
import { mount } from 'svelte';
import type { ComponentProps } from 'svelte';
import TaskIntegrations from '../../../routes/app/apps/[appId]/TaskIntegrations.svelte';

// A complete Worker: the old `as never` cast hid that this shape is what the component's
// roster and lead-status reads actually require (role, memory and cast fields included).
const workers: import('$lib/types').Worker[] = [
  {
    id: 'w1', appId: 'app-1', agentId: 'agent-1', role: 'portal-engineer',
    name: 'Iris', slug: 'iris', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:iris',
    memoryId: 'mem-1', retiredAt: null,
    agent: { id: 'agent-1', name: 'Portal', urn: 'hrn:agent:hadronmemory.com:hadron-dev-team:portal' },
    createdAt: '2026-10-01T00:00:00.000Z',
  },
];

export function mountTaskIntegrations(target: HTMLElement) {
  const props: ComponentProps<typeof TaskIntegrations> = {
    read: {
      kind: 'ok', revision: 3,
      properties: { taskIntegrations: [{
        name: 'core', provider: 'github', repositories: ['hadron-memory/hadron-portal'],
        readyLabel: 'ready', excludeLabels: ['wip'],
        teams: [{ lead: workers[0].urn, label: 'team:portal' }],
      }] },
    },
    manages: true,
    workers,
  };
  return mount(TaskIntegrations, { target, props });
}
