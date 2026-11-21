/**
 * portal#2378 — the alarms list's empty note. A page-local filter (Acknowledged) can empty a page that
 * had rows, and the note announcing it must land in a live region that was already mounted (a region
 * inserted populated may not be announced). The pin is the lifecycle: the region EXISTS and is EMPTY
 * while rows show, holds the note once the filter empties the page, and is the same element after.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import TasksAlarms from './TasksAlarms.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const alarm = { id: 'al1', type: 'TASK_STALLED', severity: 'ALARM', taskId: null, createdAt: '2026-11-20T10:00:00Z', subjectWorker: null, acknowledgedAt: null, acknowledgedBy: null, wakes: null };

describe('TasksAlarms: the empty note (portal#2378)', () => {
  it('is announced by a region that exists, empty, while rows show, and is the same element after', async () => {
    setStubPage('https://example.test/app/apps/a1/tasks?tab=alarms', { appId: 'a1' });
    const props = reactiveProps<Record<string, unknown>>({
      alarms: { kind: 'ok', value: { alarms: [alarm] } }, filter: 'all', paging: null, refs: {}, basePath: '/app/apps/a1/tasks',
    });
    const m = mountComponent(TasksAlarms as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    for (let i = 0; i < 6; i++) await tick();
    const region = () => m.target.querySelector<HTMLElement>('[data-testid="alarms-empty-region"]');
    const before = region();
    expect(before, 'mounted while an alarm shows').not.toBeNull();
    expect(before!.getAttribute('role')).toBe('status');
    expect(before!.textContent?.trim()).toBe('');
    props.filter = 'acknowledged';
    for (let i = 0; i < 6; i++) await tick();
    expect(region()).toBe(before);
    expect(before!.querySelector('[data-empty-alarms="acknowledged"]')).not.toBeNull();
    expect(before!.textContent?.trim()).not.toBe('');
  });
});
