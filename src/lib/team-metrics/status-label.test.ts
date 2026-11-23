import { describe, expect, it } from 'vitest';
import { statusLabel } from './status-label';

describe('statusLabel (#2535)', () => {
  it.each([['PENDING', 'Pending'], ['STARTED', 'Started'], ['FINISHED', 'Finished'], ['CANCELLED', 'Cancelled']])('%s reads %s', (s, l) => {
    expect(statusLabel(s)).toBe(l);
  });
  it('an unknown or odd-case status is shown as the server sent it, never hidden', () => {
    expect(statusLabel('BLOCKED')).toBe('BLOCKED');
    expect(statusLabel('started')).toBe('started');
    expect(statusLabel('')).toBe('');
  });
});
