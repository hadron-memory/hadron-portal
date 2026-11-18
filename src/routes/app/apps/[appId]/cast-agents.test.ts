import { describe, expect, it } from 'vitest';
import { castableAgentOptions, castGroups } from './cast-agents';

const agent = (id: string, name: string, personaRole?: string | null) => ({ id, name, personaRole });

describe('castableAgentOptions (#1032)', () => {
  it('drops agents with no persona role — the team agent is not a castable role', () => {
    const options = castableAgentOptions([
      agent('1', 'Hadron Dev Team', null),
      agent('2', 'Portal Engineer', 'portal-engineer'),
      agent('3', 'Unlabelled', undefined),
      agent('4', 'Blank', '   '),
    ]);
    expect(options.map((a) => a.id)).toEqual(['2']);
  });

  it('preserves the whole installed Agent, including its canonical URN', () => {
    const installed = { ...agent('1', 'Portal Engineer', 'portal-engineer'), urn: 'hrn:agent:acme.com:portal', description: 'Role agent' };
    const [option] = castableAgentOptions([installed]);
    expect(option).toMatchObject(installed);
    expect(option.urn).toBe('hrn:agent:acme.com:portal');
  });

  it('sorts by name, case-insensitively, regardless of install order', () => {
    const options = castableAgentOptions([
      agent('1', 'UX Designer', 'ux-designer'),
      agent('2', 'coordinator', 'coordinator'),
      agent('3', 'Server Engineer', 'server-engineer'),
      agent('4', 'Android App Engineer', 'android-app-engineer'),
    ]);
    expect(options.map((a) => a.name)).toEqual(['Android App Engineer', 'coordinator', 'Server Engineer', 'UX Designer']);
  });

  it('breaks a name tie by id so the order is stable', () => {
    const options = castableAgentOptions([agent('b', 'QA Engineer', 'qa'), agent('a', 'QA Engineer', 'qa')]);
    expect(options.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the install roster it was given', () => {
    const roster = [agent('1', 'Z', 'z'), agent('2', 'A', 'a')];
    castableAgentOptions(roster);
    expect(roster.map((a) => a.id)).toEqual(['1', '2']);
  });
});

describe('castGroups (#1684)', () => {
  const importer = { id: 'a', name: 'Team', urn: 'hrn:agent:acme.com:team' };
  const options = [agent('b', 'Analyst', 'analyst'), agent('c', 'Coach', 'coach')];

  it('puts a derived agent after every installed one and names its importer', () => {
    const groups = castGroups(options, { b: { kind: 'derived', importer }, c: { kind: 'installed' } });
    expect(groups.installed.map((a) => a.id)).toEqual(['c']);
    expect(groups.derived.map((d) => [d.agent.id, d.importer.name])).toEqual([['b', 'Team']]);
  });

  it('an agent with no mark stays in the plain list: a withheld answer never reads as derived', () => {
    const groups = castGroups(options, {});
    expect(groups.installed.map((a) => a.id)).toEqual(['b', 'c']);
    expect(groups.derived).toEqual([]);
  });
});
