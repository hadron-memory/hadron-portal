import { describe, expect, it } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY } from '$lib/server/queries';
import { selectsFieldPath } from './graphql-selection';

const PROPERTIES = ['agentTask', 'properties'] as const;
const MIN_TIER = ['agentTask', 'requirements', 'minTier'] as const;
const ROLE_TASK_REFS = ['agentTask', 'result', 'workedFromRoleTaskRefs'] as const;
type Rewrite = (query: string) => string;
type Case = [name: string, rewrite: Rewrite, selected: boolean];

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
const movePropertiesToRowFields = (q: string) =>
  edit(removeProperties(q), 'fragment AgentTaskRowFields on AgentTask {', 'fragment AgentTaskRowFields on AgentTask {\n    properties');

const propertiesCases: Case[] = [
  ['in a comment', q => edit(q, /^      properties\n/m, '      # properties\n'), false],
  ['aliased', q => edit(q, /^      properties\n/m, '      x: properties\n'), false],
  ['nested one level deeper', q => edit(removeProperties(q), 'result {', 'result { properties'), false],
  ['with a directive', q => edit(q, /^      properties\n/m, '      properties @include(if: true)\n'), false],
  [
    'under AgentTaskPartyFields',
    q => edit(removeProperties(q), 'fragment AgentTaskPartyFields on AgentTaskParty {', 'fragment AgentTaskPartyFields on AgentTaskParty {\n    properties'),
    false,
  ],
  ['removed', removeProperties, false],
  ['in AgentTaskRowFields', movePropertiesToRowFields, true],
  ['in an inline fragment', q => edit(q, /^      properties\n/m, '      ... on AgentTask { properties }\n'), true],
  [
    'in a named fragment with a directive',
    q => edit(movePropertiesToRowFields(q), 'agentTask(ref: $ref) {\n      ...AgentTaskRowFields', 'agentTask(ref: $ref) {\n      ...AgentTaskRowFields @include(if: false)'),
    false,
  ],
  ['in an inline fragment with a directive', q => edit(q, /^      properties\n/m, '      ... on AgentTask @include(if: false) { properties }\n'), false],
];

const minTierCases: Case[] = [
  ['in a comment', q => edit(q, /\bminTier\b/, '# minTier\n'), false],
  ['aliased', q => edit(q, /\bminTier\b/, 'x: minTier'), false],
  ['nested one level deeper', q => edit(q, /\bminTier\b/, 'nested { minTier }'), false],
  ['under an aliased requirements field', q => edit(q, /\brequirements\s*\{/, 'x: requirements {'), false],
  ['removed', q => edit(q, /\s*\bminTier\b/, ''), false],
  ['in an inline fragment', q => edit(q, /\bminTier\b/, '... on AgentTaskRequirements { minTier }'), true],
];

describe('portal#2245: result.workedFromRoleTaskRefs', () => {
  it('is selected, with the three stored fields, in the real detail query', () => {
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', ROLE_TASK_REFS)).toBe(true);
    for (const f of ['nodeId', 'urn', 'revision']) {
      expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', [...ROLE_TASK_REFS, f])).toBe(true);
    }
  });
  it.each([
    ['removed', (q: string) => edit(q, /\s*workedFromRoleTaskRefs \{[^}]*\}/, '')],
    ['aliased', (q: string) => edit(q, 'workedFromRoleTaskRefs', 'x: workedFromRoleTaskRefs')],
    ['moved out of result', (q: string) => edit(edit(q, /\s*workedFromRoleTaskRefs \{[^}]*\}/, ''), 'result {', 'workedFromRoleTaskRefs { nodeId urn revision } result {')],
  ])('is not selected when %s', (_n, rewrite) => {
    expect(selectsFieldPath(rewrite(AGENT_TASK_DETAIL_QUERY), 'AgentTaskDetail', ROLE_TASK_REFS)).toBe(false);
  });
});

describe('selectsFieldPath', () => {
  it('selects both paths in the unchanged real detail query', () => {
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', PROPERTIES)).toBe(true);
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', MIN_TIER)).toBe(true);
  });

  it.each(propertiesCases)('properties: %s', (_name, rewrite, selected) => {
    expect(selectsFieldPath(mutate(rewrite), 'AgentTaskDetail', PROPERTIES)).toBe(selected);
  });

  it.each(minTierCases)('requirements.minTier: %s', (_name, rewrite, selected) => {
    expect(selectsFieldPath(mutate(rewrite), 'AgentTaskDetail', MIN_TIER)).toBe(selected);
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
