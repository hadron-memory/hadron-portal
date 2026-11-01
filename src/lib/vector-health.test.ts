import { describe, expect, it } from 'vitest';
import { VECTOR_HEALTH_LIMIT, embedFailedView, type ValidateMemoryResult } from './vector-health';

const finding = (kind: string, n: number, detail = `detail ${n}`) => ({
  kind, nodeId: `id-${n}`, nodeLoc: `loc:${n}`, nodeUrn: `hrn:node:acme.com:mem:loc:${n}`, detail,
});
const result = (over: Partial<ValidateMemoryResult> = {}): ValidateMemoryResult => ({
  findings: [], totalFindings: 0, totalInformational: 0, truncated: false, nodesChecked: 10, skippedChecks: [], ...over,
});

describe('#1346 embedFailedView', () => {
  it('asks the server for the most findings it allows, since it has no check filter', () => {
    expect(VECTOR_HEALTH_LIMIT).toBe(1000);
  });

  it('keeps only EMBED_FAILED findings, one row each, with the detail as the reason', () => {
    const v = embedFailedView(result({
      findings: [finding('SPARSE', 1), finding('EMBED_FAILED', 2, 'dimension mismatch'), finding('BROKEN_REF', 3), finding('EMBED_FAILED', 4)],
      totalFindings: 4,
    }));
    expect(v.failed.map((f) => f.nodeId)).toEqual(['id-2', 'id-4']);
    expect(v.failed[0]).toMatchObject({ detail: 'dimension mismatch', nodeLoc: 'loc:2', nodeUrn: 'hrn:node:acme.com:mem:loc:2' });
    expect(v.truncation).toBeNull();
  });

  it('says so when the response is truncated, with the counts', () => {
    const v = embedFailedView(result({ findings: [finding('EMBED_FAILED', 1)], totalFindings: 1500, truncated: true }));
    expect(v.truncation).toEqual({ shown: 1, total: 1500 });
  });

  it('says so when totalFindings exceeds the findings returned even if truncated is false', () => {
    const v = embedFailedView(result({ findings: [finding('EMBED_FAILED', 1)], totalFindings: 3, truncated: false }));
    expect(v.truncation).toEqual({ shown: 1, total: 3 });
  });

  // #1533: server#2996 made totalFindings problems-only and added the
  // totalInformational count. A problems-free memory with many INDEX_TRUNCATED
  // declarations must not read "showing N of 0".
  it('counts informational declarations in the truncation total (#1533)', () => {
    const informational = Array.from({ length: 200 }, (_, i) => finding('INDEX_TRUNCATED', i + 1));
    const v = embedFailedView(result({
      findings: informational, totalFindings: 0, totalInformational: 450, truncated: true,
    }));
    expect(v.truncation).toEqual({ shown: 200, total: 450 });
    expect(v.failed).toEqual([]);
  });

  it('sums problems and informational declarations for the total, and flags overflow even when the server flag is false', () => {
    const v = embedFailedView(result({
      findings: [finding('EMBED_FAILED', 1), finding('INDEX_TRUNCATED', 2)],
      totalFindings: 250, totalInformational: 200, truncated: false,
    }));
    expect(v.truncation).toEqual({ shown: 2, total: 450 });
  });

  it('reports a skipped EMBED_FAILED check rather than an empty, healthy-looking list', () => {
    const v = embedFailedView(result({ skippedChecks: [{ check: 'EMBED_FAILED', reason: 'vector index off' }] }));
    expect(v.skipped).toBe('vector index off');
    expect(v.failed).toEqual([]);
  });

  it('ignores another skipped check', () => {
    expect(embedFailedView(result({ skippedChecks: [{ check: 'SCHEMA', reason: 'x' }] })).skipped).toBeNull();
  });

  it('keeps a null nodeUrn as absent', () => {
    const f = { ...finding('EMBED_FAILED', 1), nodeUrn: null };
    expect(embedFailedView(result({ findings: [f], totalFindings: 1 })).failed[0].nodeUrn).toBeNull();
  });
});
