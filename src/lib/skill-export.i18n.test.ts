/**
 * @codex on #903 — the unused-key note's LIST GRAMMAR goes through t().
 *
 * In English a template and a literal join produce the same text, so the
 * output tests in skill-export.test.ts cannot tell them apart. This file
 * records the ids t() is asked for instead: the routing is the contract.
 */
import { describe, expect, it, vi } from 'vitest';

const ids: string[] = [];
vi.mock('$lib/i18n/t', async () => {
  const actual = await vi.importActual<typeof import('$lib/i18n/t')>('$lib/i18n/t');
  return {
    ...actual,
    t: (id: string, text: string, vars?: Record<string, string | number | null | undefined>) => {
      ids.push(id);
      return actual.t(id, text, vars);
    },
  };
});

const { exportKeyList, taskExport, taskExportUnknownNote } = await import('./skill-export');

describe('list grammar is translatable (@codex on #903)', () => {
  it('the unused-key sample joins and marks omission through t() templates', () => {
    ids.length = 0;
    const note = taskExportUnknownNote(taskExport({ exports: { a: 1, b: 1, c: 1, d: 1 } }));
    expect(note).toBe('4 unused keys: "a", "b", "c", …');
    expect(ids.filter((i) => i === 'tasks.export.unknown.list')).toHaveLength(2);
    expect(ids).toContain('tasks.export.unknown.list-more');
  });

  it('the host-key list folds its "and" through t()', () => {
    ids.length = 0;
    expect(exportKeyList()).toBe('claudeSkill and codexSkill');
    expect(ids).toEqual(['skill-export.host-list.and']);
  });
});
