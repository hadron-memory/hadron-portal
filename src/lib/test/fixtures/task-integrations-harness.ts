// portal#1619: mounts the real TaskIntegrations section for scripts/test-task-integrations-focus.mjs.
// Loaded through Vite so `$lib`, `$app/*` and the component's own Svelte compile apply. Real
// Chromium is the point: jsdom computes no Tailwind cascade, so it cannot see `outline-none`
// beating `focus-visible:outline-2`.
import { mount } from 'svelte';
import TaskIntegrations from '../../../routes/app/apps/[appId]/TaskIntegrations.svelte';

const workers = [
  { id: 'w1', name: 'Iris', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:iris', retiredAt: null },
];

export function mountTaskIntegrations(target: HTMLElement) {
  return mount(TaskIntegrations as never, { target, props: {
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
  } as never });
}
