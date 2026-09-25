/**
 * #879 — what goes in the Task Nodes download, per host.
 *
 * The layouts are the part that "fails silently at an install dialog" (#879),
 * so they are pinned as literal paths rather than derived from the code under
 * test. The name guards are pinned because a skill name becomes a PATH here.
 */
import { describe, expect, it } from 'vitest';
import {
  isBundleHost,
  otherBundleHost,
  otherHostOnly,
  planBundle as planBundleWith,
  planSkillDownload,
  pluginName,
  unrecognizedReport,
  type PlanEntry,
  type PlanUnrecognized,
  type PluginVersioner,
} from './skill-bundle';
import { pluginVersion } from './server/plugin-version';

/**
 * Most tests here are about layout and refusals, not the version, so they run
 * with a fixed stand-in; the version tests below pass the real recipe.
 */
const FIXED: PluginVersioner = () => '0.0.0-htest';
const planBundle = (e: PlanEntry[], host: 'claudeSkill' | 'codexSkill', org: string) => planBundleWith(e, host, org, FIXED);

const entry = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  nodeId: 'n1',
  urn: 'hrn:node:acme.com:ops:tasks:drive-pr-home',
  name: 'drive-pr-home',
  class: 'never-exported',
  renderedBody: '---\nname: drive-pr-home\ndescription: x\n---\n\nbody\n',
  // Every EXPORT entry carries an exportPlan (schema: "Present only for
  // EXPORT"), so a legal fixture does too.
  exportPlan: { action: 'WRITE', reasons: [] },
  findings: [],
  ...over,
});

describe('planBundle — the Claude plugin layout', () => {
  it('puts the plugin root at the zip root: a manifest and skills/<name>/SKILL.md', () => {
    const b = planBundle([entry()], 'claudeSkill', 'Acme Corp');
    expect(Object.keys(b.files).sort()).toEqual(['.claude-plugin/plugin.json', 'skills/drive-pr-home/SKILL.md']);
    expect(JSON.parse(b.files['.claude-plugin/plugin.json'])).toEqual({
      name: 'acme-corp-skills',
      version: '0.0.0-htest',
      description: 'Skills exported from Acme Corp on Hadron.',
    });
    expect(b.filename).toBe('acme-corp-skills.zip');
  });

  it('writes the server-rendered body verbatim', () => {
    const b = planBundle([entry()], 'claudeSkill', 'Acme');
    expect(b.files['skills/drive-pr-home/SKILL.md']).toBe(entry().renderedBody);
  });
});

describe('planBundle — the Claude plugin version (#909)', () => {
  it('writes the content-derived version into the manifest and returns it', () => {
    const b = planBundleWith([entry()], 'claudeSkill', 'Acme Corp', pluginVersion);
    const expected = pluginVersion('acme-corp-skills', 'Skills exported from Acme Corp on Hadron.', {
      'drive-pr-home': entry().renderedBody!,
    });
    expect(b.version).toBe(expected);
    expect(JSON.parse(b.files['.claude-plugin/plugin.json']).version).toBe(expected);
  });

  it('keeps the existing plugin name: an installed plugin is identified by it', () => {
    const b = planBundleWith([entry()], 'claudeSkill', 'Acme Corp', pluginVersion);
    expect(JSON.parse(b.files['.claude-plugin/plugin.json']).name).toBe('acme-corp-skills');
    expect(b.filename).toBe('acme-corp-skills.zip');
  });

  it('hashes exactly the skills in the zip — a left-out skill does not move the version', () => {
    const seen: Array<Record<string, string>> = [];
    const spy: PluginVersioner = (_n, _d, skills) => (seen.push(skills), 'v');
    planBundleWith(
      [
        entry(),
        entry({ nodeId: 'n2', name: 'broken', renderedBody: null }),
        entry({ nodeId: 'n3', name: 'off', class: 'disabled' }),
        // A body the server rendered but did not plan to WRITE is not shipped,
        // so it must not move the version either.
        entry({ nodeId: 'n4', name: 'held', renderedBody: 'x', exportPlan: { action: 'SKIP', reasons: [] } }),
      ],
      'claudeSkill',
      'Acme',
      spy,
    );
    expect(seen).toEqual([{ 'drive-pr-home': entry().renderedBody }]);
  });

  it('is stable across two downloads of the same content, and moves when a body does', () => {
    const one = planBundleWith([entry()], 'claudeSkill', 'Acme', pluginVersion);
    const two = planBundleWith([entry()], 'claudeSkill', 'Acme', pluginVersion);
    const edited = planBundleWith([entry({ renderedBody: entry().renderedBody + 'more\n' })], 'claudeSkill', 'Acme', pluginVersion);
    expect(two.files['.claude-plugin/plugin.json']).toBe(one.files['.claude-plugin/plugin.json']);
    expect(edited.version).not.toBe(one.version);
  });

  it('has no version for Codex, whose download has no manifest', () => {
    let called = false;
    const b = planBundleWith([entry()], 'codexSkill', 'Acme', () => ((called = true), 'v'));
    expect(b.version).toBeNull();
    expect(called).toBe(false);
  });
});

describe('planBundle — the Codex skills layout', () => {
  it('is <name>/SKILL.md at the root, with no plugin manifest', () => {
    const b = planBundle([entry()], 'codexSkill', 'Acme');
    expect(Object.keys(b.files)).toEqual(['drive-pr-home/SKILL.md']);
    expect(b.filename).toBe('acme-skills-codex.zip');
  });
});

describe('planBundle — what is left out, and why', () => {
  it('reports a body the server withheld with the server\'s error findings', () => {
    const b = planBundle(
      [entry({ renderedBody: null, findings: [
        { rule: 'skill-description-missing', severity: 'error', message: 'needs a description' },
        { rule: 'skill-description-no-trigger', severity: 'warning', message: 'no trigger' },
      ] })],
      'claudeSkill',
      'Acme',
    );
    expect(b.included).toEqual([]);
    expect(b.skipped).toEqual([
      { name: 'drive-pr-home', urn: entry().urn, reasons: ['needs a description'] },
    ]);
    expect(Object.keys(b.files)).toEqual(['.claude-plugin/plugin.json']);
  });

  it('does not report an unticked task as a failure', () => {
    const b = planBundle([entry({ class: 'disabled', renderedBody: null })], 'claudeSkill', 'Acme');
    expect(b.skipped).toEqual([]);
    expect(b.included).toEqual([]);
  });

  it('never turns a name outside the grammar into a path, even with a body', () => {
    const b = planBundle([entry({ name: '../../etc', renderedBody: 'x' })], 'codexSkill', 'Acme');
    expect(b.files).toEqual({});
    expect(b.skipped[0].name).toBe('../../etc');
  });

  it('leaves BOTH entries of a duplicate name out rather than choosing one', () => {
    const b = planBundle([entry({ nodeId: 'a' }), entry({ nodeId: 'b', urn: 'hrn:node:acme.com:ops:other' })], 'codexSkill', 'Acme');
    expect(b.files).toEqual({});
    expect(b.skipped).toHaveLength(2);
  });
});

describe('pluginName', () => {
  it('reduces an org name to the plugin grammar with a -skills suffix', () => {
    expect(pluginName('Hadron Dev Team')).toBe('hadron-dev-team-skills');
    expect(pluginName('Café  Ünïon!')).toBe('cafe-union-skills');
  });

  it('falls back rather than emitting an empty name', () => {
    expect(pluginName('日本')).toBe('hadron-skills');
    expect(pluginName('')).toBe('hadron-skills');
  });

  it('stays within 64 characters and never ends a segment with a hyphen', () => {
    const n = pluginName('a'.repeat(50) + ' ' + 'b'.repeat(50));
    expect(n.length).toBeLessThanOrEqual(64);
    expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('isBundleHost', () => {
  it('accepts exactly the two host keys — `codex` is refused, per #888', () => {
    expect(isBundleHost('claudeSkill')).toBe(true);
    expect(isBundleHost('codexSkill')).toBe(true);
    expect(isBundleHost('codex')).toBe(false);
    expect(isBundleHost(undefined)).toBe(false);
  });
});

describe('planBundle — the server\'s export plan (@copilot on #890)', () => {
  it('reports a skip with NO error finding in the plan\'s own words', () => {
    const b = planBundle(
      [entry({
        renderedBody: null,
        class: 'unavailable',
        exportPlan: { action: 'SKIP', reasons: [{ code: 'unavailable', message: 'Its memory is locked.' }] },
      })],
      'claudeSkill',
      'Acme',
    );
    expect(b.skipped).toEqual([{ name: 'drive-pr-home', urn: entry().urn, reasons: ['Its memory is locked.'] }]);
  });

  it('does not repeat a reason that is both a finding and a plan reason', () => {
    const b = planBundle(
      [entry({
        renderedBody: null,
        findings: [{ rule: 'x', severity: 'error', message: 'same words' }],
        exportPlan: { action: 'FAIL', reasons: [{ code: 'x', message: 'same words' }] },
      })],
      'codexSkill',
      'Acme',
    );
    expect(b.skipped[0].reasons).toEqual(['same words']);
  });

  it('ships a body only when the plan says WRITE', () => {
    const b = planBundle(
      [entry({ exportPlan: { action: 'REFUSE', reasons: [{ code: 'r', message: 'refused' }] } })],
      'codexSkill',
      'Acme',
    );
    expect(b.files).toEqual({});
    expect(b.skipped[0].reasons).toEqual(['refused']);
    const ok = planBundle([entry({ exportPlan: { action: 'WRITE', reasons: [] } })], 'codexSkill', 'Acme');
    expect(Object.keys(ok.files)).toEqual(['drive-pr-home/SKILL.md']);
  });
});

describe('otherHostOnly — declared for the other host alone (@codex on #890)', () => {
  const o = (nodeId: string, cls: string | null) => ({ nodeId, urn: `hrn:node:acme.com:ops:${nodeId}`, name: nodeId, class: cls });

  it('keeps only what the other host exports and this host never judged', () => {
    const judgedHere = [{ nodeId: 'both' }, { nodeId: 'here-disabled' }];
    const other = [o('both', 'never-exported'), o('here-disabled', 'never-exported'), o('solo', 'never-exported'), o('off', 'disabled')];
    expect(otherHostOnly(judgedHere, other)).toEqual([{ name: 'solo', urn: 'hrn:node:acme.com:ops:solo' }]);
  });

  it('pairs each host with the other one', () => {
    expect(otherBundleHost('claudeSkill')).toBe('codexSkill');
    expect(otherBundleHost('codexSkill')).toBe('claudeSkill');
  });
});

describe('unrecognizedReport — export keys no host reads (server#1296)', () => {
  const u = (over: Partial<PlanUnrecognized> = {}): PlanUnrecognized => ({
    nodeId: 'typo',
    urn: 'hrn:node:acme.com:ops:tasks:typo',
    name: 'Typo task',
    keyCount: 1,
    keys: ['codex'],
    findings: [{ rule: 'skill-host-unknown', severity: 'warning', message: 'key "codex" names no skill host' }],
    ...over,
  });

  it('planBundle names what it included by node id', () => {
    const b = planBundle([entry(), entry({ nodeId: 'n2', name: 'broken', renderedBody: null })], 'claudeSkill', 'Acme');
    expect(b.includedNodeIds).toEqual(['n1']);
  });

  it('marks a node in the download by node id, never by URN', () => {
    const rows = unrecognizedReport(
      [u({ nodeId: 'n1', urn: 'hrn:node:acme.com:ops:tasks:other-spelling' }), u({ nodeId: 'n9', urn: entry().urn })],
      ['n1'],
    );
    expect(rows.map((r) => r.inDownload)).toEqual([true, false]);
  });

  it('reports each node once, with the true key count and the server\'s messages verbatim', () => {
    const rows = unrecognizedReport([u({ keyCount: 12 }), u({ keyCount: 12 })], []);
    expect(rows).toEqual([
      { name: 'Typo task', urn: 'hrn:node:acme.com:ops:tasks:typo', inDownload: false, keyCount: 12, messages: ['key "codex" names no skill host'] },
    ]);
  });
});

describe('planSkillDownload — one task as one skill (#911)', () => {
  it('is <name>.zip holding the skill FOLDER, the server body verbatim — the same for both hosts', () => {
    for (const host of ['claudeSkill', 'codexSkill'] as const) {
      const d = planSkillDownload(entry(), host);
      expect(d.filename).toBe('drive-pr-home.zip');
      expect(d.files).toEqual({ 'drive-pr-home/SKILL.md': entry().renderedBody });
      expect(d.reasons).toEqual([]);
    }
  });

  it('ships nothing, and says so, when the plan has no entry for the task', () => {
    const d = planSkillDownload(undefined, 'codexSkill');
    expect(d).toEqual({ files: {}, filename: null, reasons: [expect.stringContaining('no Codex entry')] });
  });

  it('ships nothing for a switched-off export, even with a body', () => {
    const d = planSkillDownload(entry({ class: 'disabled' }), 'claudeSkill');
    expect(d.filename).toBeNull();
    expect(d.reasons).toEqual([expect.stringContaining('Claude export is switched off')]);
  });

  it('prefers the server\'s own words for a switched-off export, when it gave any (@copilot on #912)', () => {
    const d = planSkillDownload(
      entry({ class: 'disabled', exportPlan: { action: 'SKIP', reasons: [{ code: 'disabled', message: 'Export is disabled for claudeSkill.' }] } }),
      'claudeSkill',
    );
    expect(d).toEqual({ files: {}, filename: null, reasons: ['Export is disabled for claudeSkill.'] });
  });

  it('gives the server\'s own reasons when it withheld the body', () => {
    const d = planSkillDownload(
      entry({ renderedBody: null, findings: [
        { rule: 'skill-description-missing', severity: 'error', message: 'needs a description' },
        { rule: 'w', severity: 'warning', message: 'just a warning' },
      ] }),
      'claudeSkill',
    );
    expect(d).toEqual({ files: {}, filename: null, reasons: ['needs a description'] });
  });

  it('does not ship a body the server did not plan to WRITE', () => {
    const d = planSkillDownload(
      entry({ exportPlan: { action: 'SKIP', reasons: [{ code: 'collision', message: 'Another node claims this name.' }] } }),
      'claudeSkill',
    );
    expect(d).toEqual({ files: {}, filename: null, reasons: ['Another node claims this name.'] });
  });

  it('ships nothing when the entry has NO planned action — a broken response is not permission (@copilot on #912)', () => {
    const d = planSkillDownload(entry({ exportPlan: null }), 'claudeSkill');
    expect(d.filename).toBeNull();
    expect(d.reasons).toEqual([expect.stringContaining('Not exportable')]);
    // The org download applies the same rule: it is one shared verdict.
    const b = planBundle([entry({ exportPlan: undefined })], 'codexSkill', 'Acme');
    expect(b.files).toEqual({});
    expect(b.skipped).toHaveLength(1);
  });

  it('never turns a name outside the grammar into a path', () => {
    const d = planSkillDownload(entry({ name: '../../etc', renderedBody: 'x' }), 'codexSkill');
    expect(d.files).toEqual({});
    expect(d.filename).toBeNull();
    expect(d.reasons).toEqual([expect.stringContaining('not a valid skill name')]);
  });
});
