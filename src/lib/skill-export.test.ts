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
  CODEX_HOST,
  DESCRIPTION_MAX,
  NAME_MAX,
  SKILL_HOSTS,
  codePoints,
  declarationProblems,
  declarationState,
  defaultSkillName,
  enableSkillExport,
  readDeclaration,
  readExports,
  readSkillExport,
  validSkillName,
  withoutSkillExport,
  writeDeclaration,
  writeSkillExport,
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

/**
 * @copilot on #867 — a field of the WRONG TYPE is not an editable declaration.
 *
 * Coercing it to '' would render an empty name and write that back over the
 * stored value on the next save, destroying something the user was never
 * shown. Absent fields are different and stay fillable.
 */
describe('a declaration this form cannot represent is left alone', () => {
  it.each([
    ['a numeric name', { name: 42, description: 'd', enable: true }],
    ['a numeric description', { name: 'n', description: 7 }],
    ['a string enable', { name: 'n', enable: 'yes' }],
    ['a nested object name', { name: { a: 1 } }],
  ])('reads %s as absent rather than coercing it', (_what, entry) => {
    expect(readDeclaration({ exports: { claudeSkill: entry } })).toBeNull();
  });

  it.each([
    ['a numeric name', { name: 42, description: 'd', enable: true }],
    ['a string enable', { name: 'n', enable: 'yes' }],
  ])('and does not DELETE %s on a removal', (_what, entry) => {
    // The two rules have to agree: an entry reported as absent must not then be
    // removed by the seeding path, or the UI deletes what it refused to show.
    const props = { exports: { claudeSkill: entry } };
    expect(writeDeclaration(props, null)).toEqual(props);
  });

  it('still accepts a declaration with fields merely MISSING', () => {
    // Absent is editable; wrongly-typed is not. Filling in a missing `enable`
    // is the whole job.
    expect(readDeclaration({ exports: { claudeSkill: { name: 'x' } } }))
      .toEqual({ name: 'x', description: '', enable: false });
  });
});

/**
 * #878 — one checkbox, two hosts.
 *
 * A declaration is per-host (D12), so "export this skill" writes `claudeSkill`
 * AND `codex`. The hazards are the two directions of that: a save that widens a
 * Claude-only declaration nobody touched, and a write that flattens two host
 * entries that disagree into one the user was never shown.
 */
describe('the host keys', () => {
  it('declares both hosts, Claude first', () => {
    expect(CODEX_HOST).toBe('codex');
    expect(SKILL_HOSTS).toEqual(['claudeSkill', 'codex']);
  });
});

const both = (d: { name: string; description: string; enable: boolean }) => ({
  exports: { claudeSkill: { ...d }, codex: { ...d } },
});

describe('readSkillExport', () => {
  it('reads nothing as absent, not divergent', () => {
    expect(readSkillExport({ other: 1 })).toEqual({ value: null, divergent: false });
  });

  it('reads a pre-#878 Claude-only declaration with ONE host', () => {
    // The host list is what stops a save from silently adding Codex.
    const r = readSkillExport(REAL);
    expect(r.divergent).toBe(false);
    expect(r.value?.hosts).toEqual(['claudeSkill']);
    expect(r.value?.declaration.name).toBe('hadron-cast-worker');
  });

  it('reads two agreeing hosts as one declaration on both', () => {
    const r = readSkillExport(both(decl()));
    expect(r.value).toEqual({ declaration: decl(), hosts: ['claudeSkill', 'codex'] });
  });

  it.each([
    ['names differ', { exports: { claudeSkill: decl(), codex: decl({ name: 'other' }) } }],
    ['descriptions differ', { exports: { claudeSkill: decl(), codex: decl({ description: 'x' }) } }],
    ['one is off', { exports: { claudeSkill: decl(), codex: decl({ enable: false }) } }],
    ['codex is malformed', { exports: { claudeSkill: decl(), codex: 'yes' } }],
    ['codex has a wrongly-typed field', { exports: { claudeSkill: decl(), codex: { name: 42 } } }],
  ])('reports DIVERGENT when %s', (_what, props) => {
    expect(readSkillExport(props)).toEqual({ value: null, divergent: true });
  });

  it('ignores hosts it does not own', () => {
    const r = readSkillExport({ exports: { claudeSkill: decl(), somethingElse: { name: 'z' } } });
    expect(r.value?.hosts).toEqual(['claudeSkill']);
  });
});

describe('withoutSkillExport / writeSkillExport', () => {
  it('removes both owned hosts and keeps a host it does not own', () => {
    const props = { k: 1, exports: { ...both(decl()).exports, other: { name: 'o' } } };
    expect(withoutSkillExport(props)).toEqual({ k: 1, exports: { other: { name: 'o' } } });
  });

  it('leaves a DIVERGENT bag whole — the raw editor owns it', () => {
    const props = { exports: { claudeSkill: decl(), codex: decl({ name: 'other' }) } };
    expect(withoutSkillExport(props)).toEqual(props);
  });

  it('round-trips an untouched Claude-only declaration without adding codex', () => {
    const { value } = readSkillExport(REAL);
    expect(writeSkillExport(withoutSkillExport(REAL), value)).toEqual(REAL);
  });

  it('writes the one declaration to every listed host', () => {
    const out = writeSkillExport({ k: 1 }, { declaration: decl(), hosts: [...SKILL_HOSTS] });
    expect(out).toEqual({ k: 1, ...both(decl()) });
  });

  it('writes nothing for a null export', () => {
    expect(writeSkillExport({ k: 1 }, null)).toEqual({ k: 1 });
  });
});

describe('enableSkillExport — what checking the box does', () => {
  const defaults = { name: 'from-loc', description: 'From the node. Use when X.' };

  it('starts an absent export ON, for every host, with the defaults', () => {
    expect(enableSkillExport(null, defaults)).toEqual({
      declaration: { name: 'from-loc', description: 'From the node. Use when X.', enable: true },
      hosts: ['claudeSkill', 'codex'],
    });
  });

  it('keeps fields the user already wrote', () => {
    // Re-checking after an uncheck must not replace their name with a default.
    const off = { declaration: decl({ name: 'mine', description: 'my words', enable: false }), hosts: ['claudeSkill'] };
    expect(enableSkillExport(off, defaults).declaration).toEqual({
      name: 'mine',
      description: 'my words',
      enable: true,
    });
  });

  it('fills a BLANK field with its default', () => {
    const off = { declaration: decl({ name: '  ', description: '', enable: false }), hosts: ['claudeSkill'] };
    expect(enableSkillExport(off, defaults).declaration).toMatchObject({
      name: 'from-loc',
      description: 'From the node. Use when X.',
    });
  });

  it('widens a Claude-only declaration to every host — checking is the explicit act', () => {
    const off = { declaration: decl({ enable: false }), hosts: ['claudeSkill'] };
    expect(enableSkillExport(off, defaults).hosts).toEqual(['claudeSkill', 'codex']);
  });
});

describe('defaultSkillName', () => {
  it.each([
    ['tasks:drive-pr-home', 'Drive PR home', 'drive-pr-home'],
    ['tasks:Start_Worker Session', 'x', 'start-worker-session'],
    ['review', 'Review', 'review'],
    ['tasks:café-crème', 'x', 'cafe-creme'],
    ['tasks:---', 'Fallback Name', 'fallback-name'],
    ['', 'Only a Name!', 'only-a-name'],
    ['tasks:🙂', '🙂', ''],
  ])('%s / %s → %s', (loc, name, expected) => {
    expect(defaultSkillName(loc, name)).toBe(expected);
  });

  it('is always a name the server accepts, when it is anything at all', () => {
    for (const [loc, name] of [
      ['a:' + 'word-'.repeat(30), 'x'],
      ['a:' + 'x'.repeat(100), 'x'],
      ['a:Über Straße 12', 'x'],
    ]) {
      const got = defaultSkillName(loc, name);
      expect(got.length).toBeGreaterThan(0);
      expect(validSkillName(got)).toBe(true);
    }
  });

  it('cuts an over-long loc at a hyphen, not mid-word', () => {
    const got = defaultSkillName('a:' + 'abcde-'.repeat(20), 'x');
    expect(got.length).toBeLessThanOrEqual(NAME_MAX);
    expect(got.endsWith('abcde')).toBe(true);
  });
});

describe('validSkillName — the server grammar', () => {
  it.each(['a', 'drive-pr-home', 'x1-2y', 'a'.repeat(NAME_MAX)])('accepts %s', (n) => {
    expect(validSkillName(n)).toBe(true);
  });
  it.each(['', 'A', 'a_b', 'a--b', '-a', 'a-', 'a b', 'a'.repeat(NAME_MAX + 1)])('refuses %j', (n) => {
    expect(validSkillName(n)).toBe(false);
  });
});

describe('declarationProblems — #878 additions', () => {
  it('reports an invalid name, even while off', () => {
    const p = declarationProblems(decl({ name: 'Not Valid', enable: false }));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('lowercase');
  });

  it('reports an enabled export with no description', () => {
    expect(declarationProblems(decl({ description: ' ' }))).toHaveLength(1);
  });

  it('does not nag about a blank description while off', () => {
    expect(declarationProblems(decl({ description: '', enable: false }))).toEqual([]);
  });

  it('reports an enabled export on a node that is not runnable', () => {
    expect(declarationProblems(decl(), { runnable: false })).toHaveLength(1);
    expect(declarationProblems(decl(), { runnable: true })).toEqual([]);
    // Unknown is not "not runnable".
    expect(declarationProblems(decl())).toEqual([]);
  });

  it('counts the description in CODE POINTS, as the server does', () => {
    // An emoji is two UTF-16 units and one code point. At the cap in code points
    // it is legal, though `.length` would call it over.
    const atCap = '🙂'.repeat(DESCRIPTION_MAX);
    expect(atCap.length).toBe(DESCRIPTION_MAX * 2);
    expect(codePoints(atCap)).toBe(DESCRIPTION_MAX);
    expect(declarationProblems(decl({ description: atCap }))).toEqual([]);
    expect(declarationProblems(decl({ description: atCap + 'x' }))).toHaveLength(1);
  });
});
