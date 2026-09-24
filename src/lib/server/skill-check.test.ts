/**
 * #882 — fetching the server's LINT verdict for one stored node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SKILL_PLAN_LINT_QUERY } from '$lib/server/queries';
import { loadSkillCheck } from './skill-check';

const request = vi.fn();
const client = { request } as never;
const decl = { name: 'x', description: 'd', enable: true };

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadSkillCheck', () => {
  it('asks nothing for a node that declares no host', async () => {
    expect(await loadSkillCheck(client, { id: 'n1', memoryId: 'm1', properties: { url: 'x' } })).toEqual({ kind: 'none' });
    expect(request).not.toHaveBeenCalled();
  });

  it('runs one LINT plan per DECLARED host, scoped to the node\'s memory', async () => {
    request.mockResolvedValue({ skillPlan: { entries: [{ nodeId: 'n1', class: null, findings: [] }] } });
    const r = await loadSkillCheck(client, { id: 'n1', memoryId: 'm1', properties: { exports: { claudeSkill: decl } } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(SKILL_PLAN_LINT_QUERY, { host: 'claudeSkill', memories: ['m1'] });
    expect(r).toEqual({
      kind: 'checked',
      hosts: [{ host: 'claudeSkill', status: 'judged', off: false, errors: [], warnings: [] }],
    });
  });

  it('asks for a node that still carries a retired top-level declaration, as claudeSkill (@codex on #905)', async () => {
    request.mockResolvedValue({ skillPlan: { entries: [{ nodeId: 'n1', class: null, findings: [] }] } });
    await loadSkillCheck(client, { id: 'n1', memoryId: 'm1', properties: { skill: decl } });
    expect(request).toHaveBeenCalledWith(SKILL_PLAN_LINT_QUERY, { host: 'claudeSkill', memories: ['m1'] });
  });

  it('a failed check is reported per host with the server\'s words — it neither throws nor passes', async () => {
    request.mockImplementation(async (_q: string, vars: { host: string }) => {
      if (vars.host === 'codexSkill') throw new Error('plan exploded');
      return { skillPlan: { entries: [{ nodeId: 'n1', class: null, findings: [] }] } };
    });
    const r = await loadSkillCheck(client, {
      id: 'n1',
      memoryId: 'm1',
      properties: { exports: { claudeSkill: decl, codexSkill: decl } },
    });
    expect(r.kind).toBe('checked');
    if (r.kind === 'checked') {
      expect(r.hosts[0]).toMatchObject({ host: 'claudeSkill', status: 'judged' });
      expect(r.hosts[1]).toMatchObject({ host: 'codexSkill', status: 'unavailable' });
      expect((r.hosts[1] as { detail: string }).detail).toContain('plan exploded');
    }
  });
});
