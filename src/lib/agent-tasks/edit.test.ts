/**
 * portal#1357 — what the Edit details form sends (hadron-server#2645,
 * `updateAgentTask`, a strict patch). Only a field the reader changed goes;
 * emptying an optional field clears it; a field whose base wasn't posted is
 * never sent; nothing outside the six editable fields can be named.
 */
import { describe, expect, it } from 'vitest';
import { taskEditPatch } from './edit';

const REQ = { role: null, familyIn: [], familyNotIn: [], excludeWorkers: [] };
function form(over: Record<string, string | string[]> = {}, omit: string[] = []) {
  const base: Record<string, string | string[]> = {
    title: 'Ship it', titleBase: 'Ship it',
    description: 'Do the thing', descriptionBase: 'Do the thing',
    tags: 'a, b', tagsBase: 'a, b',
    startBy: '', startByUtc: '', startByBase: '',
    closeSessionWhenDone: 'on', closeSessionWhenDoneBase: 'true',
    role: '', familyIn: [], familyNotIn: [], excludeWorkers: [],
    requirementsBase: JSON.stringify(REQ),
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) {
    if (omit.includes(k)) continue;
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  }
  return fd;
}
const input = (fd: FormData) => {
  const r = taskEditPatch(fd);
  if ('invalid' in r) throw new Error(`invalid: ${r.invalid.message}`);
  return r.input;
};

describe('taskEditPatch: only what changed', () => {
  it('an untouched form sends nothing', () => {
    expect(input(form())).toEqual({});
  });

  it.each([
    [{ title: 'Ship it now' }, { title: 'Ship it now' }],
    [{ description: 'Do the other thing' }, { description: 'Do the other thing' }],
    [{ tags: 'a, b, c' }, { tags: ['a', 'b', 'c'] }],
  ])('%j sends exactly %j', (over, expected) => {
    expect(input(form(over as Record<string, string>))).toEqual(expected);
  });

  it('the end-the-session choice sends false (not omitted) when switched off, and true when switched on', () => {
    const off = form();
    off.delete('closeSessionWhenDone');
    expect(input(off)).toEqual({ closeSessionWhenDone: false });
    expect(input(form({ closeSessionWhenDoneBase: 'false' }))).toEqual({ closeSessionWhenDone: true });
  });

  it('tags that normalise to the base (spacing, repeats, empties) send nothing', () => {
    expect(input(form({ tags: ' a ,b,, a' }))).toEqual({});
  });

  it('whitespace-only differences in the text fields send nothing', () => {
    expect(input(form({ title: '  Ship it ', description: 'Do the thing  ' }))).toEqual({});
  });
});

describe('taskEditPatch: emptying an optional field clears it', () => {
  it('description → null', () => {
    expect(input(form({ description: '   ' }))).toEqual({ description: null });
  });
  it('tags → []', () => {
    expect(input(form({ tags: '' }))).toEqual({ tags: [] });
  });
  it('start by → null', () => {
    expect(input(form({ startBy: '', startByUtc: '', startByBase: '2026-11-01T09:00:00.000Z' }))).toEqual({ startBy: null });
  });
  it('requirements emptied entirely → null', () => {
    const base = { role: 'qa-engineer', familyIn: ['codex'], familyNotIn: [], excludeWorkers: ['w1'] };
    expect(input(form({ requirementsBase: JSON.stringify(base), role: '', familyIn: [], excludeWorkers: [] }))).toEqual({ requirements: null });
  });
});

describe('taskEditPatch: the title cannot be emptied', () => {
  it.each(['', '   '])('%j is invalid on the title, with a sentence', (title) => {
    const r = taskEditPatch(form({ title }));
    expect(r).toMatchObject({ invalid: { field: 'title' } });
    expect((r as { invalid: { message: string } }).invalid.message).toMatch(/title/i);
  });
});

describe('taskEditPatch: start by', () => {
  it('uses the instant the browser computed', () => {
    expect(input(form({ startBy: '2026-11-02T10:30', startByUtc: '2026-11-02T15:30:00.000Z' }))).toEqual({ startBy: '2026-11-02T15:30:00.000Z' });
  });
  it('without the browser’s instant, the local value reads as UTC', () => {
    expect(input(form({ startBy: '2026-11-02T10:30', startByUtc: '' }))).toEqual({ startBy: '2026-11-02T10:30:00.000Z' });
  });
  it('the same minute as the base sends nothing (the control carries no seconds)', () => {
    expect(input(form({ startBy: '2026-11-02T10:30', startByUtc: '2026-11-02T10:30:00.000Z', startByBase: '2026-11-02T10:30:41.250Z' }))).toEqual({});
  });
  it('a malformed value is invalid on the start-by field', () => {
    expect(taskEditPatch(form({ startBy: 'tomorrow', startByUtc: '' }))).toMatchObject({ invalid: { field: 'startBy' } });
  });
});

describe('taskEditPatch: requirements replace whole, keeping what the reader did not change', () => {
  const base = { role: 'qa-engineer', familyIn: [], familyNotIn: ['glm'], excludeWorkers: ['w-gone', 'w2'] };
  it('changing the role sends the whole object with the other values as posted', () => {
    expect(input(form({ requirementsBase: JSON.stringify(base), role: 'portal-engineer', familyNotIn: ['glm'], excludeWorkers: ['w-gone', 'w2'] }))).toEqual({
      requirements: { role: 'portal-engineer', familyNotIn: ['glm'], excludeWorkers: ['w-gone', 'w2'] },
    });
  });
  it('the same values in another order send nothing', () => {
    expect(input(form({ requirementsBase: JSON.stringify(base), role: 'qa-engineer', familyNotIn: ['glm'], excludeWorkers: ['w2', 'w-gone'] }))).toEqual({});
  });
  it('one family list or the other: "run as" wins when both are posted', () => {
    expect(input(form({ familyIn: ['codex'], familyNotIn: ['glm'] }))).toEqual({ requirements: { familyIn: ['codex'] } });
  });
});

describe('taskEditPatch: the guard rails', () => {
  it('a field whose base was not posted is never sent', () => {
    expect(input(form({ title: 'Changed', description: 'Changed', tags: 'z' }, ['titleBase', 'descriptionBase', 'tagsBase']))).toEqual({});
    expect(input(form({ role: 'qa-engineer' }, ['requirementsBase']))).toEqual({});
    expect(input(form({}, ['closeSessionWhenDoneBase']))).toEqual({});
  });

  it('source, owner, assignee, status, parent, priority and blockers are never sent', () => {
    const fd = form({ title: 'Changed' });
    for (const k of ['source', 'owner', 'assignee', 'status', 'parentTaskId', 'priority', 'blockedBy', 'taskId', 'id']) fd.append(k, 'x');
    expect(input(fd)).toEqual({ title: 'Changed' });
  });
});
