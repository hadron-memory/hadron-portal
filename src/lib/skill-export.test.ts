/**
 * portal#864 Part A — the skill-declaration helpers.
 *
 * The case that earns this file is `preserves a SIBLING host`. hadron-server
 * #1227: `updateNodeProperties` merges one level and `properties.exports` is
 * two, so a client that patches one host destroys every other host's
 * declaration — silently.
 *
 * **No fixture in either repo has two hosts today**, because `claudeSkill` is
 * the only one that exists. That is exactly why every suite currently passes
 * on code that would destroy a sibling, and why the fixtures below invent
 * `codexSkill` rather than waiting for hadron-cli#622 to ship it.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_SKILL_HOST,
  DESCRIPTION_MAX,
  declarationProblems,
  declarationState,
  readDeclaration,
  readExports,
  writeDeclaration,
} from './skill-export';

const decl = (over: Partial<{ name: string; description: string; enable: boolean }> = {}) => ({
  name: 'hadron-x',
  description: 'does a thing',
  enable: true,
  ...over,
});

/** The real shape, from hrn:node:hadronmemory.com:core:tasks:cast-worker. */
const REAL = {
  exports: {
    claudeSkill: { name: 'hadron-cast-worker', enable: true, description: 'Cast a new named …' },
  },
};

describe('writeDeclaration — the #1227 shape', () => {
  it('preserves a SIBLING host', () => {
    // The whole point. A patch-shaped write would drop codexSkill here, with no
    // error, and the only symptom would be a skill that stops exporting for a
    // host nobody touched.
    const before = {
      exports: {
        claudeSkill: { name: 'a', description: 'a', enable: true },
        codexSkill: { name: 'b', description: 'b', enable: true },
      },
    };
    const after = writeDeclaration(before, decl({ name: 'a2' }));
    expect(after.exports).toEqual({
      claudeSkill: { name: 'a2', description: 'does a thing', enable: true },
      codexSkill: { name: 'b', description: 'b', enable: true },
    });
  });

  it('preserves UNRELATED property keys', () => {
    // `exports` is one key in a free-form bag. Losing its neighbours would be
    // the same defect one level up.
    const after = writeDeclaration({ owner: 'gil', count: 3, ...REAL }, decl());
    expect(after.owner).toBe('gil');
    expect(after.count).toBe(3);
  });

  it('removing a host leaves its siblings alone', () => {
    const before = {
      exports: {
        claudeSkill: { name: 'a', description: 'a', enable: true },
        codexSkill: { name: 'b', description: 'b', enable: true },
      },
    };
    expect(writeDeclaration(before, null).exports).toEqual({
      codexSkill: { name: 'b', description: 'b', enable: true },
    });
  });

  it('removing the LAST host drops `exports` entirely rather than leaving {}', () => {
    // An empty exports object is indistinguishable from a real declaration at a
    // glance, and listDeclaredIDs would have to special-case it.
    const after = writeDeclaration(REAL, null);
    expect('exports' in after).toBe(false);
  });

  it('writes onto a node with no properties at all', () => {
    expect(writeDeclaration(null, decl())).toEqual({
      exports: { claudeSkill: { name: 'hadron-x', description: 'does a thing', enable: true } },
    });
  });

  it('does not mutate its input', () => {
    // The edit page holds this object in form state; mutating it in place would
    // make the "unsaved changes" comparison lie.
    const before = structuredClone(REAL);
    writeDeclaration(before, decl({ name: 'changed' }));
    expect(before).toEqual(REAL);
  });

  it('stores exactly the three declared fields, dropping anything else', () => {
    const after = writeDeclaration(REAL, decl());
    expect(Object.keys((after.exports as Record<string, Record<string, unknown>>).claudeSkill).sort())
      .toEqual(['description', 'enable', 'name']);
  });
});

describe('readDeclaration', () => {
  it('reads the real corpus shape', () => {
    expect(readDeclaration(REAL)).toEqual({
      name: 'hadron-cast-worker',
      description: 'Cast a new named …',
      enable: true,
    });
  });

  it('reads a MISSING enable as off, not as absent', () => {
    // Every declaration until now was hand-typed into a raw textarea, so a
    // missing key is the likely case rather than the exotic one. Reading the
    // whole declaration as absent would discard the name the user did write.
    const d = readDeclaration({ exports: { claudeSkill: { name: 'x', description: 'y' } } });
    expect(d).toEqual({ name: 'x', description: 'y', enable: false });
  });

  it.each([
    ['no properties', null],
    ['no exports key', { other: 1 }],
    ['exports is not an object', { exports: 'claudeSkill' }],
    ['the host is not an object', { exports: { claudeSkill: 'yes' } }],
    ['a different host only', { exports: { codexSkill: { name: 'b' } } }],
  ])('returns null for %s', (_what, props) => {
    expect(readDeclaration(props)).toBeNull();
  });

  it('survives a malformed exports rather than throwing', () => {
    // `properties` is a bag a user can hand-edit. A malformed value must not
    // take the editor down with it.
    expect(() => readExports({ exports: [1, 2, 3] })).not.toThrow();
    expect(readExports({ exports: [1, 2, 3] })).toEqual({});
  });
});

describe('declarationState — absent is NOT the same as switched off', () => {
  it.each([
    ['absent', null, 'absent'],
    ['declared and enabled', REAL, 'declared-on'],
    ['declared but off', { exports: { claudeSkill: { name: 'x', description: '', enable: false } } }, 'declared-off'],
    ['declared with enable missing', { exports: { claudeSkill: { name: 'x' } } }, 'declared-off'],
  ])('%s', (_what, props, expected) => {
    expect(declarationState(props)).toBe(expected);
  });

  it('distinguishes off from absent — the distinction the platform keeps', () => {
    // listDeclaredIDs deliberately does not filter on `enable`, so lint can
    // judge a not-enabled declaration BEFORE someone turns it on. A UI that
    // rendered these identically would throw that away.
    const off = declarationState({ exports: { claudeSkill: { name: 'x', enable: false } } });
    expect(off).not.toBe(declarationState(null));
  });
});

describe('declarationProblems — advisory, because the server is the authority', () => {
  it('reports a description over the cap, with both numbers', () => {
    const over = declarationProblems(decl({ description: 'x'.repeat(DESCRIPTION_MAX + 1) }));
    expect(over).toHaveLength(1);
    expect(over[0]).toContain(String(DESCRIPTION_MAX + 1));
    expect(over[0]).toContain(String(DESCRIPTION_MAX));
  });

  it('accepts a description exactly AT the cap', () => {
    // Off-by-one in the direction that would nag a user about a legal value.
    expect(declarationProblems(decl({ description: 'x'.repeat(DESCRIPTION_MAX) }))).toEqual([]);
  });

  it('reports an enabled export with no name', () => {
    expect(declarationProblems(decl({ name: '  ' }))).toHaveLength(1);
  });

  it('does NOT nag about a missing name while the export is switched off', () => {
    // A declaration being drafted is a legitimate state — `enable` defaults to
    // OFF precisely so one can exist before it publishes.
    expect(declarationProblems(decl({ name: '', enable: false }))).toEqual([]);
  });
});

describe('the host key', () => {
  it('is the one D12 shipped', () => {
    // Pinned because it is a wire contract with two other repos, and a typo
    // here produces a declaration that silently never exports.
    expect(CLAUDE_SKILL_HOST).toBe('claudeSkill');
  });
});

/**
 * @copilot on #867 — the SEEDING hazard, which is data loss rather than a
 * wrong render.
 *
 * The edit page seeds its raw-properties editor with `writeDeclaration(props,
 * null)` — "the bag minus the part I own". Before the guard, that call deleted
 * an `exports` the editor cannot represent and the user never touched, so
 * opening such a node and pressing Save destroyed it with no error.
 */
describe('removing what is not there is a NO-OP', () => {
  it.each([
    ['a malformed exports (a string)', { other: 1, exports: 'oops' }],
    ['a host entry that is not an object', { other: 1, exports: { claudeSkill: 'yes' } }],
    ['an exports holding only OTHER hosts', { other: 1, exports: { codexSkill: { name: 'b' } } }],
    ['an exports that is an array', { other: 1, exports: [1, 2] }],
    ['no exports key at all', { other: 1 }],
  ])('leaves %s exactly as found', (_what, props) => {
    expect(writeDeclaration(props, null)).toEqual(props);
  });

  it('still removes a host that IS present and readable', () => {
    // The guard must not disable the real removal.
    expect('exports' in writeDeclaration(REAL, null)).toBe(false);
  });

  it('declaring ONTO an unreadable exports replaces it — the one discarding case', () => {
    // Stated as a test because it is the exception: there is no way to merge
    // into a string, and it takes an explicit "Declare for export" to reach.
    const after = writeDeclaration({ exports: 'oops' }, decl());
    expect(after.exports).toEqual({ claudeSkill: { name: 'hadron-x', description: 'does a thing', enable: true } });
  });
});
