/**
 * #882 — the server's verdict on a stored skill export, reduced for the edit page.
 */
import { describe, expect, it } from 'vitest';
import { declaredHosts, groupHostChecks, hostCheck, type HostCheck, type LintEntry } from './skill-check';

const decl = { name: 'x', description: 'd', enable: true };
const entry = (over: Partial<LintEntry> = {}): LintEntry => ({ nodeId: 'n1', class: null, findings: [], ...over });

describe('declaredHosts', () => {
  it('names only the hosts the STORED properties declare', () => {
    expect(declaredHosts({})).toEqual([]);
    expect(declaredHosts({ exports: { claudeSkill: decl } })).toEqual(['claudeSkill']);
    expect(declaredHosts({ exports: { claudeSkill: decl, codexSkill: decl } })).toEqual(['claudeSkill', 'codexSkill']);
    // A key no host reads is not a host to ask about (server#1296's report covers it).
    expect(declaredHosts({ exports: { codex: decl } })).toEqual([]);
  });
});

describe('hostCheck', () => {
  it('picks THIS node out of the memory-wide plan, splitting errors from warnings', () => {
    const entries = [
      entry({ nodeId: 'other', findings: [{ rule: 'r', severity: 'error', message: 'not mine' }] }),
      entry({
        findings: [
          { rule: 'skill-name-invalid', severity: 'error', message: 'name "Create Release Tag!" is invalid' },
          { rule: 'skill-name-invalid', severity: 'error', message: 'name "Create Release Tag!" is invalid' },
          { rule: 'skill-description-long', severity: 'warning', message: 'long description' },
        ],
      }),
    ];
    expect(hostCheck('claudeSkill', 'n1', entries)).toEqual({
      host: 'claudeSkill',
      status: 'judged',
      off: false,
      errors: ['name "Create Release Tag!" is invalid'],
      warnings: ['long description'],
    });
  });

  it('a stored export that is switched off is judged, and marked off', () => {
    expect(hostCheck('claudeSkill', 'n1', [entry({ class: 'disabled' })])).toMatchObject({ status: 'judged', off: true });
  });

  it('a declared node the plan did not judge is reported as such — never read as passing', () => {
    expect(hostCheck('claudeSkill', 'n1', [entry({ nodeId: 'other' })])).toEqual({ host: 'claudeSkill', status: 'not-judged' });
  });
});

describe('groupHostChecks', () => {
  const ok = (host: string): HostCheck => ({ host, status: 'judged', off: false, errors: [], warnings: [] });

  it('renders identical verdicts once, naming every host', () => {
    expect(groupHostChecks([ok('claudeSkill'), ok('codexSkill')])).toEqual([
      { hosts: ['claudeSkill', 'codexSkill'], check: { status: 'judged', off: false, errors: [], warnings: [] } },
    ]);
  });

  it('keeps hosts that differ apart, in declared order', () => {
    const bad: HostCheck = { host: 'codexSkill', status: 'judged', off: false, errors: ['too long for Codex'], warnings: [] };
    expect(groupHostChecks([ok('claudeSkill'), bad]).map((g) => g.hosts)).toEqual([['claudeSkill'], ['codexSkill']]);
  });
});
