/**
 * #1724 — the History row's Validation cell, mounted: badge plus the report's
 * time, task revision and author check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import HistoryValidationCell from './HistoryValidationCell.svelte';
import { formatPortalDateTime } from '$lib/format-portal-date';
import { validationView, type NodeContentValidationStatus } from '$lib/node-provenance';

const VALIDATOR = 'hrn:node:acme.com:ops:tasks:check-spec';
const AT = '2026-09-27T10:00:00.000Z';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});
const q = (el: Element, id: string) => el.querySelector(`[data-testid="${id}"]`);

async function cell(status: NodeContentValidationStatus) {
  const m = mountComponent(HistoryValidationCell as never, { view: validationView({ ok: true, value: status }) } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m.target;
}
const report = (over = {}) => ({
  nodeRevision: 3, validationTaskRef: VALIDATOR, validationTaskRevision: 2, outcome: 'PASS' as const, reportedAt: AT, authorCheck: 'CHECKED' as const, ...over,
});

describe('HistoryValidationCell', () => {
  it('CHECKED: badge, time, task revision and the neutral author check; the badge stays compact', async () => {
    const t = await cell({ state: 'PASS', latestReport: report() });
    expect(q(t, 'validation-state')!.textContent!.trim()).toBe('Passed');
    const detail = q(t, 'history-validation-detail')!.textContent!;
    expect(detail).toContain(formatPortalDateTime(AT));
    expect(detail).toContain('task revision 2');
    expect(detail).toContain('Author compared and differs');
    expect(detail).not.toMatch(/independent/i);
    // compact mode keeps the badge's own long detail and author line out of the cell
    expect(q(t, 'validation-author-check')).toBeNull();
    expect(q(t, 'validation-detail')).toBeNull();
  });

  it('AUTHOR_UNKNOWN is worded as no comparison', async () => {
    const t = await cell({ state: 'PASS', latestReport: report({ authorCheck: 'AUTHOR_UNKNOWN' }) });
    expect(q(t, 'history-validation-detail')!.textContent).toContain('Author not compared');
  });

  it('a pre-#1332 report (null) has no author text and a missing task revision is left out', async () => {
    const t = await cell({ state: 'PASS', latestReport: report({ authorCheck: null, validationTaskRevision: null }) });
    const detail = q(t, 'history-validation-detail')!.textContent!;
    expect(detail).toContain(formatPortalDateTime(AT));
    expect(detail).not.toMatch(/Author|task revision/);
  });

  it('an unparseable time shows a dash, never "Invalid Date"', async () => {
    const t = await cell({ state: 'PASS', latestReport: report({ reportedAt: 'not-a-date' }) });
    const detail = q(t, 'history-validation-detail')!.textContent!;
    expect(detail).not.toContain('Invalid Date');
    expect(detail).toContain('—');
  });

  it('an older revision with a late report keeps its own outcome, shown as that row', async () => {
    const t = await cell({ state: 'FAIL', latestReport: report({ outcome: 'FAIL', nodeRevision: 2 }) });
    expect(q(t, 'validation-state')!.getAttribute('data-state')).toBe('FAIL');
    expect(q(t, 'history-validation-detail')).not.toBeNull();
  });

  it('no report: the badge alone', async () => {
    const t = await cell({ state: 'UNVALIDATED', latestReport: null });
    expect(q(t, 'validation-state')!.textContent!.trim()).toBe('Not validated');
    expect(q(t, 'history-validation-detail')).toBeNull();
  });
});
