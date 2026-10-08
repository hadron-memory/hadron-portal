import { describe, expect, it } from 'vitest';
import { approveAllFeedbackWarning, approveAllSummary } from './memory-approval';

describe('approveAllSummary (#992)', () => {
  it('counts what was approved, what already was, and the skipped placeholders', () => {
    expect(approveAllSummary({ approvedCount: 1, alreadyApprovedCount: 0, skippedPlaceholders: [], openFeedback: [] })).toBe('Approved 1 node.');
    expect(approveAllSummary({ approvedCount: 0, alreadyApprovedCount: 4, skippedPlaceholders: [], openFeedback: [] })).toBe('Approved 0 nodes. 4 were already approved.');
    expect(approveAllSummary({ approvedCount: 2, alreadyApprovedCount: 0, skippedPlaceholders: ['a', 'b'], openFeedback: [] }))
      .toBe('Approved 2 nodes. Skipped 2 placeholders, which have no spec to approve yet:');
  });
});

describe('approveAllFeedbackWarning (portal#1014)', () => {
  it('is null without open discussions, and counts the nodes that have them', () => {
    expect(approveAllFeedbackWarning({ openFeedback: [] })).toBeNull();
    expect(approveAllFeedbackWarning({ openFeedback: [{ urn: 'hrn:node:a:b:c', openThreads: 1 }] })).toMatch(/^1 node in this memory has an open discussion\./);
    // local review on #1025, P3: one node, several threads, says so.
    expect(approveAllFeedbackWarning({ openFeedback: [{ urn: 'hrn:node:a:b:c', openThreads: 2 }] })).toMatch(/^1 node in this memory has 2 open discussions\./);
    expect(approveAllFeedbackWarning({ openFeedback: [{ urn: 'hrn:node:a:b:c', openThreads: 1 }, { urn: 'hrn:node:a:b:d', openThreads: 1 }] })).toMatch(/^2 nodes in this memory/);
  });
});
