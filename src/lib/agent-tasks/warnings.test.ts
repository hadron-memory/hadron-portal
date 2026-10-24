/**
 * portal#1214 — decoding a task write's `extensions.warnings`
 * (hadron-server#2198 at eb2cb49a): this write's path only, server order,
 * code and text verbatim, tolerant of anything malformed, and provenance
 * (`committed`) decided before decoding.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SHOWN_WARNINGS, readTaskWarnings } from './warnings';

const URN = 'hrn:node:hadronmemory.com:hadron-dev-team-roles:tasks:find-a-source';
const w = (code: string, text = `text for ${code}`, extra: Record<string, unknown> = {}) => ({ path: 'createAgentTask', code, text, ...extra });

describe('readTaskWarnings', () => {
  it('keeps this path’s warnings in server order, code and text verbatim', () => {
    const r = readTaskWarnings({ warnings: [w('task.create.no-source', 'No source: <b>link one</b>'), w('task.assign.assignee-busy')] }, 'createAgentTask');
    expect(r).toEqual({
      warnings: [
        { code: 'task.create.no-source', text: 'No source: <b>link one</b>' },
        { code: 'task.assign.assignee-busy', text: 'text for task.assign.assignee-busy' },
      ],
      more: 0,
      committed: true,
    });
  });

  it('absent, empty or non-array warnings are nothing, and not a commit', () => {
    for (const ext of [undefined, null, {}, { warnings: [] }, { warnings: 'x' }, 'x', 3]) {
      expect(readTaskWarnings(ext, 'createAgentTask')).toEqual({ warnings: [], more: 0, committed: false });
    }
  });

  it('ignores a warning under another path, so it proves nothing about this write', () => {
    const r = readTaskWarnings({ warnings: [{ ...w('task.create.no-source'), path: 'other' }] }, 'createAgentTask');
    expect(r).toEqual({ warnings: [], more: 0, committed: false });
  });

  it('passes an unknown code through verbatim', () => {
    expect(readTaskWarnings({ warnings: [w('task.future.thing', 'Something new')] }, 'createAgentTask').warnings).toEqual([
      { code: 'task.future.thing', text: 'Something new' },
    ]);
  });

  it('skips malformed and oversized entries, ignores extra fields, and still reports the commit', () => {
    const r = readTaskWarnings({
      warnings: [
        { path: 'createAgentTask' },
        { path: 'createAgentTask', code: 7, text: 'x' },
        w('', 'empty code'),
        w('task.create.no-source', ''),
        w('c'.repeat(129)),
        w('task.create.no-source', 't'.repeat(1025)),
        null,
        'x',
        w('task.create.no-source', 'kept', { extra: { deep: true } }),
      ],
    }, 'createAgentTask');
    expect(r.warnings).toEqual([{ code: 'task.create.no-source', text: 'kept' }]);
    expect(r.committed).toBe(true);
  });

  it('a path with only malformed entries is still committed: decoding never decides provenance', () => {
    expect(readTaskWarnings({ warnings: [{ path: 'createAgentTask', code: null }] }, 'createAgentTask')).toEqual({ warnings: [], more: 0, committed: true });
  });

  it('shows at most the server’s cap and counts the rest', () => {
    const many = Array.from({ length: MAX_SHOWN_WARNINGS + 3 }, (_, i) => w(`code.${i}`));
    const r = readTaskWarnings({ warnings: many }, 'createAgentTask');
    expect(r.warnings.map((x) => x.code)).toEqual(['code.0', 'code.1', 'code.2', 'code.3', 'code.4']);
    expect(r.more).toBe(3);
    expect(r.committed).toBe(true);
  });

  it('keeps a mapped register only with a canonical v2 node URN', () => {
    const mapped = (taskUrn: unknown) =>
      readTaskWarnings({ warnings: [w('task.create.no-source', 'x', { register: { state: 'mapped', taskLoc: 'tasks:find-a-source', taskUrn } })] }, 'createAgentTask').warnings[0];
    expect(mapped(URN)).toEqual({ code: 'task.create.no-source', text: 'x', register: { state: 'mapped', taskLoc: 'tasks:find-a-source', taskUrn: URN } });
    for (const bad of [
      'hrn:mem:hadronmemory.com:hadron-dev-team-roles',
      'hrn:node:hadronmemory.com::roles::tasks:x',
      'javascript:alert(1)',
      'hrn:node:x:l',
      42,
      undefined,
    ]) {
      expect(mapped(bad)).toEqual({ code: 'task.create.no-source', text: 'x' });
    }
  });

  it('keeps unmapped and unresolved, and drops an unknown register state', () => {
    const reg = (register: unknown) => readTaskWarnings({ warnings: [w('c', 'x', { register })] }, 'createAgentTask').warnings[0].register;
    expect(reg({ state: 'unmapped' })).toEqual({ state: 'unmapped' });
    expect(reg({ state: 'unresolved', taskUrn: URN })).toEqual({ state: 'unresolved' });
    expect(reg({ state: 'maybe' })).toBeUndefined();
    expect(reg('mapped')).toBeUndefined();
  });
});
