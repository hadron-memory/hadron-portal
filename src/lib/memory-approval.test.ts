import { describe, expect, it } from 'vitest';
import { approveAllSummary } from './memory-approval';

describe('approveAllSummary (#992)', () => {
  it('counts what was approved, what already was, and the skipped placeholders', () => {
    expect(approveAllSummary({ approvedCount: 1, alreadyApprovedCount: 0, skippedPlaceholders: [] })).toBe('Approved 1 node.');
    expect(approveAllSummary({ approvedCount: 0, alreadyApprovedCount: 4, skippedPlaceholders: [] })).toBe('Approved 0 nodes. 4 were already approved.');
    expect(approveAllSummary({ approvedCount: 2, alreadyApprovedCount: 0, skippedPlaceholders: ['a', 'b'] }))
      .toBe('Approved 2 nodes. Skipped 2 placeholders, which have no spec to approve yet:');
  });
});
