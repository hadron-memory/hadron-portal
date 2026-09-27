/**
 * #914 — authorship and advisory validation, as the server reports them
 * (server #1326). Fixtures are shapes the server can actually return: a
 * redacted task nulls taskRef AND taskRevision together, and UNVALIDATED
 * carries no report.
 */
import { describe, expect, it } from 'vitest';
import {
  authorshipText,
  authorshipView,
  provenanceById,
  taskLink,
  validationText,
  validationView,
  type NodeAuthorship,
  type NodeContentValidationStatus,
} from './node-provenance';

const TASK = 'hrn:node:acme.com:ops:tasks:write-spec';
const VALIDATOR = 'hrn:node:acme.com:ops:tasks:check-spec';
const AT = '2026-09-27T10:00:00.000Z';

const taskStamp = (over: Partial<NodeAuthorship> = {}): NodeAuthorship => ({
  kind: 'TASK', taskRef: TASK, taskRevision: 3, human: null, authoredAt: AT, ...over,
});

describe('taskLink', () => {
  it('links a node URN only through the access-checked /app/u resolver', () => {
    expect(taskLink(TASK, 3)).toEqual({ urn: TASK, href: `/app/u/${TASK}`, revision: 3 });
  });

  it('refuses anything that is not a node URN rather than linking it', () => {
    for (const ref of [null, undefined, '', 'tasks:write-spec', 'https://evil.example/x', 'hrn:mem:acme.com:ops', 'javascript:alert(1)', 'hrn:node:acme.com: ops']) {
      expect(taskLink(ref, 1)).toBeNull();
    }
  });
});

describe('authorshipView / authorshipText', () => {
  it('a readable task: written WITH the task at its revision, and never a compliance claim', () => {
    const v = authorshipView(taskStamp());
    expect(v).toEqual({ kind: 'task', task: { urn: TASK, href: `/app/u/${TASK}`, revision: 3 }, authoredAt: AT });
    const text = authorshipText(v);
    expect(text).toBe(`Written with ${TASK} (revision 3)`);
    expect(text).not.toMatch(/valid|compl|conform|verified|outdated/i);
  });

  it('an older task revision is plain historical authorship, not "outdated"', () => {
    const text = authorshipText(authorshipView(taskStamp({ taskRevision: 1 })));
    expect(text).toBe(`Written with ${TASK} (revision 1)`);
  });

  it('a redacted task (deleted or unreadable, indistinguishably) is "not available to you" and names nothing', () => {
    const v = authorshipView(taskStamp({ taskRef: null, taskRevision: null }));
    expect(v).toEqual({ kind: 'task-unavailable', authoredAt: AT });
    const text = authorshipText(v);
    expect(text).toBe("Written with a task that isn't available to you");
    expect(text).not.toMatch(/deleted|removed|hrn:/i);
  });

  it('a malformed taskRef is treated as unavailable, never linked', () => {
    expect(authorshipView(taskStamp({ taskRef: 'not-a-urn' })).kind).toBe('task-unavailable');
  });

  it('a person: by handle when resolved, else an honest "a person"', () => {
    const human = (h: { handle: string | null; urn: string | null } | null): NodeAuthorship => ({
      kind: 'HUMAN', taskRef: null, taskRevision: null, human: h, authoredAt: AT,
    });
    expect(authorshipText(authorshipView(human({ handle: 'dara', urn: 'hrn:user:dara' })))).toBe('Edited by @dara');
    for (const h of [null, { handle: null, urn: null }, { handle: '  ', urn: 'hrn:user:x' }]) {
      expect(authorshipText(authorshipView(human(h)))).toBe('Edited by a person');
    }
  });

  it('no stamp (legacy or unknown) says so, and is not an error', () => {
    expect(authorshipView(null)).toEqual({ kind: 'none' });
    expect(authorshipText(authorshipView(undefined))).toBe('No authorship recorded');
  });

  it('an unknown kind from a newer server claims nothing', () => {
    expect(authorshipView({ ...taskStamp(), kind: 'AGENT' as never })).toEqual({ kind: 'none' });
  });
});

describe('validationView / validationText', () => {
  const report = (over: Partial<NonNullable<NodeContentValidationStatus['latestReport']>> = {}) => ({
    nodeRevision: 7, validationTaskRef: VALIDATOR, validationTaskRevision: 2, outcome: 'PASS' as const, reportedAt: AT, ...over,
  });
  const ok = (value: NodeContentValidationStatus) => validationView({ ok: true, value });

  it('UNVALIDATED: "Not validated", neutral, no report', () => {
    const v = ok({ state: 'UNVALIDATED', latestReport: null });
    expect(v).toMatchObject({ state: 'UNVALIDATED', tone: 'neutral', report: null, task: null });
    expect(validationText(v)).toBe('Not validated');
  });

  it('PASS carries its report and the validating task link', () => {
    const v = ok({ state: 'PASS', latestReport: report() });
    expect(v.tone).toBe('pass');
    expect(v.task).toEqual({ urn: VALIDATOR, href: `/app/u/${VALIDATOR}`, revision: 2 });
    expect(validationText(v)).toBe('Passed');
  });

  it('FAIL and ERROR ask for attention but are not errors, and say which one', () => {
    const fail = ok({ state: 'FAIL', latestReport: report({ outcome: 'FAIL' }) });
    const err = ok({ state: 'ERROR', latestReport: report({ outcome: 'ERROR' }) });
    expect([fail.tone, err.tone]).toEqual(['attention', 'attention']);
    expect(validationText(fail)).toBe("Didn't pass");
    expect(validationText(err)).toBe("Couldn't complete");
  });

  it('STALE names the revision it last checked, whatever that check said', () => {
    const v = ok({ state: 'STALE', latestReport: report({ nodeRevision: 4, outcome: 'FAIL' }) });
    expect(v).toMatchObject({ state: 'STALE', tone: 'neutral', checkedRevision: 4 });
    expect(validationText(v)).toBe('Out of date (last checked at revision 4)');
  });

  it('a redacted validating task gives no link', () => {
    const v = ok({ state: 'PASS', latestReport: report({ validationTaskRef: null, validationTaskRevision: null }) });
    expect(v.task).toBeNull();
    expect(v.report).not.toBeNull();
  });

  it('a failed read, a missing value or an unknown state is "Couldn\'t load", never a verdict', () => {
    for (const v of [
      validationView({ ok: false }),
      validationView({ ok: true, value: null }),
      validationView({ ok: true, value: { state: 'SKIPPED' as never, latestReport: null } }),
    ]) {
      expect(v).toMatchObject({ state: 'UNAVAILABLE', tone: 'neutral', report: null });
      expect(validationText(v)).toBe("Couldn't load");
    }
  });
});

describe('provenanceById', () => {
  it('indexes History provenance by revision id', () => {
    const a = { id: 'r1', revNo: 1, authorship: null, contentValidation: { state: 'UNVALIDATED' as const, latestReport: null } };
    expect(provenanceById([a]).get('r1')).toBe(a);
    expect(provenanceById([a]).get('r2')).toBeUndefined();
  });
});
