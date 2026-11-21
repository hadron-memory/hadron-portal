import { describe, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import TasksAlarms from './TasksAlarms.svelte';
import TaskHistory from './TaskHistory.svelte';

const worker = { id: 'worker-1', kind: 'WORKER' as const, name: 'Wren', urn: 'hrn:worker:acme.com:team:wren' };
const alarm = {
  id: 'alarm-1', type: 'alarm.start-failing', severity: 'ALARM' as const,
  taskId: null, createdAt: '2026-11-21T12:00:00Z', subjectWorker: worker,
  acknowledgedAt: null, acknowledgedBy: null, wakes: [],
};

describe('task-less start-failing alarm', () => {
  it('shows the rule and addressable worker without a task link in the alarms grid', async () => {
    const { target, unmount } = mountComponent(TasksAlarms, {
      alarms: { kind: 'ok', value: { alarms: [alarm] } }, filter: 'in-effect', refs: {}, basePath: '/app/apps/a',
    });
    try {
      await tick(2);
      expect(target.textContent).toContain('Worker starts failing');
      expect(target.textContent).toContain('Wren');
      expect(target.textContent).toContain(worker.urn);
      expect(target.querySelector('a[href="/app/workers/worker-1"]')).not.toBeNull();
      expect(target.querySelector('a[href*="/tasks/"]')).toBeNull();
    } finally { unmount(); }
  });

  it('names the same worker and URN in an alarm history entry', async () => {
    const event = { ...alarm, actor: null, actorRunId: null, payload: { failures: 3, windowMinutes: 60 } };
    const { target, unmount } = mountComponent(TaskHistory, { events: [event], basePath: '/app/apps/a' });
    try {
      await tick(2);
      expect(target.textContent).toContain('Worker starts failing');
      expect(target.textContent).toContain('Wren');
      expect(target.textContent).toContain(worker.urn);
      expect(target.querySelector('a[href*="/tasks/"]')).toBeNull();
    } finally { unmount(); }
  });
});
