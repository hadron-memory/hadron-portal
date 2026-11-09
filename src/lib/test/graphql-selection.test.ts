import { describe, expect, it } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY } from '$lib/server/queries';
import { selectsFieldPath } from './graphql-selection';

const PROPERTIES = ['agentTask', 'properties'] as const;
const MIN_TIER = ['agentTask', 'requirements', 'minTier'] as const;
const REQUIREMENTS = 'requirements { role familyIn familyNotIn excludeWorkerIds minTier }';
type Rewrite = (query: string) => string;
type Case = [name: string, rewrite: Rewrite, selected: boolean, oldSelected: boolean];

function edit(query: string, search: string | RegExp, replacement: string): string {
  if (typeof search === 'string') expect(query).toContain(search);
  else expect(query).toMatch(search);
  return query.replace(search, replacement);
}
function mutate(rewrite: Rewrite): string {
  const mutant = rewrite(AGENT_TASK_DETAIL_QUERY);
  expect(mutant).not.toBe(AGENT_TASK_DETAIL_QUERY);
  return mutant;
}
const removeProperties = (q: string) => edit(q, /^      properties\n/m, '');

const propertiesCases: Case[] = [
  ['in a comment', q => edit(q, /^      properties\n/m, '      # properties\n'), false, true],
  ['aliased', q => edit(q, /^      properties\n/m, '      x: properties\n'), false, true],
  ['nested one level deeper', q => edit(removeProperties(q), 'result { outcome summary evidence }', 'result { outcome summary evidence properties }'), false, true],
  ['with a directive', q => edit(q, /^      properties\n/m, '      properties @include(if: true)\n'), false, true],
  [
    'under AgentTaskPartyFields',
    q => edit(removeProperties(q), 'fragment AgentTaskPartyFields on AgentTaskParty { id kind name urn }', 'fragment AgentTaskPartyFields on AgentTaskParty { id kind name urn properties }'),
    false,
    true,
  ],
  ['removed', removeProperties, false, false],
  ['in AgentTaskRowFields', q => edit(removeProperties(q), '    tags\n  }', '    tags\n    properties\n  }'), true, true],
  ['in an inline fragment', q => edit(q, /^      properties\n/m, '      ... on AgentTask { properties }\n'), true, true],
];

const minTierCases: Case[] = [
  ['in a comment', q => edit(q, REQUIREMENTS, 'requirements { role familyIn familyNotIn excludeWorkerIds # minTier\n }'), false, true],
  ['aliased', q => edit(q, REQUIREMENTS, 'requirements { role familyIn familyNotIn excludeWorkerIds x: minTier }'), false, true],
  ['nested one level deeper', q => edit(q, REQUIREMENTS, 'requirements { role familyIn familyNotIn excludeWorkerIds nested { minTier } }'), false, true],
  ['under an aliased requirements field', q => edit(q, REQUIREMENTS, `x: ${REQUIREMENTS}`), false, true],
  ['removed', q => edit(q, REQUIREMENTS, 'requirements { role familyIn familyNotIn excludeWorkerIds }'), false, false],
  ['in an inline fragment', q => edit(q, REQUIREMENTS, 'requirements { role familyIn familyNotIn excludeWorkerIds ... on AgentTaskRequirements { minTier } }'), true, true],
];

describe('selectsFieldPath', () => {
  it('selects both paths in the unchanged real detail query', () => {
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', PROPERTIES)).toBe(true);
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', MIN_TIER)).toBe(true);
  });

  it.each(propertiesCases)('properties: %s', (_name, rewrite, selected, oldSelected) => {
    const mutant = mutate(rewrite);
    expect(/\bproperties\b/.test(mutant)).toBe(oldSelected);
    expect(selectsFieldPath(mutant, 'AgentTaskDetail', PROPERTIES)).toBe(selected);
  });

  it.each(minTierCases)('requirements.minTier: %s', (_name, rewrite, selected, oldSelected) => {
    const mutant = mutate(rewrite);
    expect(/requirements\s*\{[^}]*\bminTier\b/.test(mutant)).toBe(oldSelected);
    expect(selectsFieldPath(mutant, 'AgentTaskDetail', MIN_TIER)).toBe(selected);
  });

  it('scopes the check to the named operation', () => {
    const query = `query Other { agentTask { properties } } query AgentTaskDetail { agentTask { id } }`;
    expect(selectsFieldPath(query, 'AgentTaskDetail', PROPERTIES)).toBe(false);
  });

  it('terminates on unresolved and cyclic spreads without accepting their structure', () => {
    const query = `
      fragment Loop on AgentTask { ...Loop }
      query AgentTaskDetail { agentTask { ...Loop ...Missing } }
    `;
    expect(selectsFieldPath(query, 'AgentTaskDetail', PROPERTIES)).toBe(false);
    const directField = query.replace('...Missing }', '...Missing properties }');
    expect(selectsFieldPath(directField, 'AgentTaskDetail', PROPERTIES)).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', [])).toBe(false);
  });
});
