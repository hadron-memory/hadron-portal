/**
 * portal#2016 — `actionResultOf` discriminates with kit's own
 * `isActionFailure`, not a numeric-status sniff. Its input is a REAL route
 * action's direct return (`fail()`'s ActionFailure, or superforms' plain
 * `{ form }`), never the wire ActionResult — but the wire shape of a SUCCESS
 * also carries a numeric status (`{ type: 'success', status: 200, data }`),
 * and under the old `typeof r.status === 'number'` check that shape read as a
 * failure. The class is the only safe discriminator, so the stub borrows
 * kit's rather than adding a second opinion.
 */
import { fail, isActionFailure } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { actionResultOf } from './app-forms';

describe('#2016: actionResultOf discriminates with kit, not a status sniff', () => {
  it('a wire-shaped success (type success, numeric status) is NOT a failure', () => {
    expect(actionResultOf({ type: 'success', status: 200, data: { form: {} } }).type).toBe('success');
  });

  it('a fail() return is a failure carrying its status and data', () => {
    const r = actionResultOf(fail(409, { form: { loc: 'taken' }, metaSaved: true }) as unknown as Record<string, unknown>);
    expect(r).toEqual({ type: 'failure', status: 409, data: { form: { loc: 'taken' }, metaSaved: true } });
  });

  it('a plain superforms success (message() without a status) stays a success whose data is the whole object', () => {
    expect(actionResultOf({ form: { name: 'Renamed' } })).toEqual({ type: 'success', status: 200, data: { form: { name: 'Renamed' } } });
  });

  it('kit itself discriminates the same two shapes the stub receives', () => {
    expect(isActionFailure(fail(500, { x: 1 }))).toBe(true);
    expect(isActionFailure({ type: 'success', status: 200 })).toBe(false);
    expect(isActionFailure({ form: {} })).toBe(false);
  });
});
