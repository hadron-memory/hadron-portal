/**
 * #914 — Revision / Authorship / Content validation rows, mounted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import NodeProvenanceRows from './NodeProvenanceRows.svelte';
import NodeAuthorshipText from './NodeAuthorshipText.svelte';
import NodeValidationBadge from './NodeValidationBadge.svelte';
import { authorshipView, validationView, type NodeProvenance } from '$lib/node-provenance';

const TASK = 'hrn:node:acme.com:ops:tasks:write-spec';
const VALIDATOR = 'hrn:node:acme.com:ops:tasks:check-spec';
const AT = '2026-09-27T10:00:00.000Z';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});
function mount(C: unknown, props: Record<string, unknown>) {
  const m = mountComponent(C as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}
const q = (el: Element, id: string) => el.querySelector(`[data-testid="${id}"]`);

function prov(over: Partial<NodeProvenance> = {}): NodeProvenance {
  return {
    id: 'n1',
    authorship: { kind: 'TASK', taskRef: TASK, taskRevision: 3, human: null, authoredAt: AT },
    contentValidation: { state: 'UNVALIDATED', latestReport: null },
    ...over,
  };
}

describe('NodeProvenanceRows', () => {
  it('while the read is pending: the revision shows, the rest says loading', async () => {
    const { target } = mount(NodeProvenanceRows, { result: null, revision: 5 });
    await tick();
    expect(q(target, 'node-revision')!.textContent).toBe('5');
    expect(q(target, 'authorship-loading')).not.toBeNull();
    expect(q(target, 'validation-loading')).not.toBeNull();
  });

  it('a failed read says "Couldn\'t load" for both, never a guessed state', async () => {
    const { target } = mount(NodeProvenanceRows, { result: { ok: false }, revision: 5 });
    await tick();
    expect(q(target, 'authorship-unavailable')!.textContent).toBe("Couldn't load");
    expect(q(target, 'validation-state')!.getAttribute('data-state')).toBe('UNAVAILABLE');
    expect(q(target, 'validation-state')!.textContent!.trim()).toBe("Couldn't load");
    expect(q(target, 'authorship-none')).toBeNull();
  });

  it('a task stamp links through /app/u and says it records use, not compliance', async () => {
    const { target } = mount(NodeProvenanceRows, { result: { ok: true, value: prov() }, revision: 5 });
    await tick();
    const line = q(target, 'authorship-task')!;
    // Rendered through the shared Urn component (Codex on #956): a linked chip.
    const a = line.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(`/app/u/${TASK}`);
    expect(a.textContent!.replace(/\s+/g, '')).toBe(TASK);
    expect(line.textContent).toMatch(/^\s*Written with/);
    expect(line.textContent).toMatch(/\(revision 3\)\s*$/);
    expect(q(target, 'authorship-task-note')!.textContent).toMatch(/doesn't show that the content follows it/);
  });

  it('a redacted task renders no link and no reference at all', async () => {
    const result = { ok: true, value: prov({ authorship: { kind: 'TASK', taskRef: null, taskRevision: null, human: null, authoredAt: AT } }) };
    const { target } = mount(NodeProvenanceRows, { result, revision: 5 });
    await tick();
    const line = q(target, 'authorship-task-unavailable')!;
    expect(line.textContent).toBe("Written with a task that isn't available to you");
    expect(target.querySelector('a')).toBeNull();
    expect(target.textContent).not.toContain('hrn:');
  });

  it('a person renders the handle and, when the server gives one, their URN chip', async () => {
    const human = (urn: string | null) => ({
      ok: true,
      value: prov({ authorship: { kind: 'HUMAN', taskRef: null, taskRevision: null, human: { handle: 'dara', urn }, authoredAt: AT } }),
    });
    let { target } = mount(NodeProvenanceRows, { result: human('hrn:user:dara'), revision: 5 });
    await tick();
    const line = q(target, 'authorship-human')!;
    expect(line.textContent).toContain('Edited by @dara');
    expect(line.querySelector('a')!.getAttribute('href')).toBe('/app/u/hrn:user:dara');
    ({ target } = mount(NodeProvenanceRows, { result: human(null), revision: 5 }));
    await tick();
    expect(q(target, 'authorship-human')!.querySelector('a, code')).toBeNull(); // absent, never an empty chip
  });

  it('a read for a newer revision is withheld as "changed", never shown beside older content', async () => {
    const { target } = mount(NodeProvenanceRows, { result: { ok: false, changed: true }, revision: 5 });
    await tick();
    expect(q(target, 'authorship-changed')!.textContent).toMatch(/Changed since this page loaded/);
    expect(q(target, 'validation-state')!.getAttribute('data-state')).toBe('CHANGED');
    expect(q(target, 'authorship-unavailable')).toBeNull();
    expect(target.querySelector('a')).toBeNull();
  });

  it('no stamp: "No authorship recorded"', async () => {
    const { target } = mount(NodeProvenanceRows, { result: { ok: true, value: prov({ authorship: null }) }, revision: 1 });
    await tick();
    expect(q(target, 'authorship-none')!.textContent).toBe('No authorship recorded');
  });

  it('a failed check is advisory: no alert role, nothing disabled, and it says it doesn\'t block editing', async () => {
    const result = {
      ok: true,
      value: prov({
        contentValidation: {
          state: 'FAIL',
          latestReport: { nodeRevision: 5, validationTaskRef: VALIDATOR, validationTaskRevision: 2, outcome: 'FAIL', reportedAt: AT },
        },
      }),
    };
    const { target } = mount(NodeProvenanceRows, { result, revision: 5 });
    await tick();
    expect(q(target, 'validation-state')!.textContent!.trim()).toBe("Didn't pass");
    expect(q(target, 'validation-advisory')!.textContent).toMatch(/doesn't block editing/);
    expect(q(target, 'validation-advisory')!.textContent).toMatch(/separate from schema validation/);
    expect(target.querySelector('[role="alert"], [aria-invalid="true"], [disabled]')).toBeNull();
    const link = q(target, 'validation-detail')!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(`/app/u/${VALIDATOR}`);
    expect(q(target, 'validation-detail')!.textContent).toMatch(/Checked revision 5/);
  });

  it('stale: names the revision last checked', async () => {
    const result = {
      ok: true,
      value: prov({
        contentValidation: {
          state: 'STALE',
          latestReport: { nodeRevision: 3, validationTaskRef: null, validationTaskRevision: null, outcome: 'PASS', reportedAt: AT },
        },
      }),
    };
    const { target } = mount(NodeProvenanceRows, { result, revision: 5 });
    await tick();
    expect(q(target, 'validation-state')!.textContent!.trim()).toBe('Out of date (last checked at revision 3)');
    expect(q(target, 'validation-detail')!.textContent).toMatch(/with a task that isn't available to you/);
    expect(q(target, 'validation-detail')!.querySelector('a')).toBeNull();
  });

  it('no revision (a legacy snapshot): the Revision row is omitted, not shown as 0', async () => {
    const { target } = mount(NodeProvenanceRows, { result: { ok: true, value: prov() }, revision: null });
    await tick();
    expect(q(target, 'node-revision')).toBeNull();
  });
});

describe('compact (History cells)', () => {
  it('the authorship cell keeps the link but drops the note', async () => {
    const { target } = mount(NodeAuthorshipText, { view: authorshipView(prov().authorship), compact: true });
    await tick();
    expect(q(target, 'authorship-task')!.querySelector('a')!.getAttribute('href')).toBe(`/app/u/${TASK}`);
    expect(q(target, 'authorship-task-note')).toBeNull();
  });

  it('the validation cell is the badge alone', async () => {
    const view = validationView({
      ok: true,
      value: { state: 'FAIL', latestReport: { nodeRevision: 2, validationTaskRef: VALIDATOR, validationTaskRevision: 1, outcome: 'FAIL', reportedAt: AT } },
    });
    const { target } = mount(NodeValidationBadge, { view, compact: true });
    await tick();
    expect(q(target, 'validation-state')!.textContent!.trim()).toBe("Didn't pass");
    expect(q(target, 'validation-detail')).toBeNull();
    expect(q(target, 'validation-advisory')).toBeNull();
  });
});
