import { describe, expect, it } from 'vitest';
import { refusalText, type ScheduleOp } from './schedule-refusal';

/** portal#1701 acceptance 7: a refused user sees a plain reason and who to ask, never a raw code or the server's words. */
describe('refusalText', () => {
  const ops: ScheduleOp[] = ['create', 'edit', 'pause', 'resume'];
  const reasons = ['forbidden', 'not-found', 'invalid'] as const;

  it('says something different and plain for each operation that can be refused', () => {
    const forbidden = ops.map((op) => refusalText(op, 'forbidden', true));
    expect(new Set(forbidden).size).toBe(4);
    for (const text of forbidden) expect(text).toMatch(/\bask\b/i);
  });

  it('names who may create, change, pause and resume', () => {
    expect(refusalText('create', 'forbidden')).toMatch(/organization admin/i);
    expect(refusalText('edit', 'forbidden')).toMatch(/organization admin/i);
    expect(refusalText('resume', 'forbidden')).toMatch(/organization admin/i);
    expect(refusalText('pause', 'forbidden')).toMatch(/organization admin/i);
  });

  it('names the creator only when the schedule has a stored run-as user', () => {
    expect(refusalText('edit', 'forbidden', true)).toMatch(/created this schedule/i);
    expect(refusalText('resume', 'forbidden', true)).toMatch(/created this schedule/i);
    for (const op of ['edit', 'resume'] as const) expect(refusalText(op, 'forbidden')).not.toMatch(/created/i);
  });

  it('never shows a code, the mechanism or the server\'s own words', () => {
    for (const op of ops) for (const reason of reasons) {
      expect(refusalText(op, reason)).not.toMatch(/FORBIDDEN|NOT_FOUND|BAD_USER_INPUT|run-as|stored|principal|enabled|GraphQL/i);
    }
  });
});
