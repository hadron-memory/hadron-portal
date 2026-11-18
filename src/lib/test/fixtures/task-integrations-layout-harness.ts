// portal#1676: mounts the real TaskIntegrations section for scripts/test-task-integrations-layout.mjs.
// Loaded through Vite so the compiled Tailwind applies: jsdom computes no `pointer-coarse:` heights
// and measures no overflow. Every lead state is on the page, with a URN long enough to truncate.
import { mount } from 'svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import TaskIntegrations from '../../../routes/app/apps/[appId]/TaskIntegrations.svelte';

const long = 'hrn:worker:hadronmemory.com:hadron-dev-team';
export const URNS = {
  live: `${long}:iris`,
  retired: `${long}:olga-who-retired-with-a-long-enough-name`,
  missing: `${long}:a-lead-this-roster-does-not-hold-any-more-at-all`,
};
const workers = [
  { id: 'w1', name: 'Iris', urn: URNS.live, retiredAt: null },
  { id: 'w2', name: 'Olga', urn: URNS.retired, retiredAt: '2026-10-01T00:00:00Z' },
];

export function mountTaskIntegrations(target: HTMLElement, rosterFailed = false) {
  return mount(TaskIntegrations, { target, props: {
    read: {
      kind: 'ok', revision: 3,
      properties: { taskIntegrations: [{
        name: 'core', provider: 'github', repositories: ['hadron-memory/hadron-portal'],
        readyLabel: 'ready', excludeLabels: ['wip'],
        teams: [
          { lead: URNS.live, label: 'team:portal' },
          { lead: URNS.retired, label: 'team:old' },
          { lead: URNS.missing, label: 'team:gone' },
          { lead: null, label: 'team:none' },
        ],
      }] },
    },
    manages: true,
    workers: rosterFailed ? null : workers,
  } });
}

/** The save refused as a conflict, the one state that shows Reload. */
export function refuseWithConflict(form: HTMLFormElement) {
  return submitEnhancedWithResult(form, {
    type: 'success', status: 200,
    data: { taskIntegrationsResult: { ok: false, code: 'APP_PROPERTIES_CONFLICT', message: 'Someone else changed these settings.', path: null, currentRevision: 9 } },
  });
}
