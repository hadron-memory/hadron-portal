/**
 * portal#1607 — a task's externalId (hadron-server#3137, hrn:node:hadronmemory.com:specs:cor:agt:120:02) on the
 * detail page: a link for an http(s) URL, text for anything else, nothing for null.
 * Display only: it is set once, when the task is created.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { Kind, parse, type FieldNode, type OperationDefinitionNode } from 'graphql';
import TaskExternalId from './TaskExternalId.svelte';
import { AGENT_TASK_DETAIL_QUERY } from '$lib/server/queries';

const html = (externalId: string | null) => render(TaskExternalId, { props: { externalId } }).body;

/**
 * Is `externalId` a direct, unaliased field of `agentTask` in AgentTaskDetail? The page reads it under that
 * name. Direct only, which is where the query has it: moving it into a fragment means updating this check.
 */
const selectsExternalId = (query: string) => {
  const operation = parse(query).definitions.find(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION && d.name?.value === 'AgentTaskDetail',
  );
  const agentTask = operation?.selectionSet.selections.find(
    (s): s is FieldNode => s.kind === Kind.FIELD && s.name.value === 'agentTask',
  );
  return (
    agentTask?.selectionSet?.selections.some(s => s.kind === Kind.FIELD && s.name.value === 'externalId' && !s.alias) ??
    false
  );
};

/** The real detail query with its `externalId` line rewritten: a mutant, not an invented document. */
const mutate = (rewrite: (query: string) => string) => {
  const line = /^\s*externalId$/m;
  expect(AGENT_TASK_DETAIL_QUERY).toMatch(line);
  const mutant = rewrite(AGENT_TASK_DETAIL_QUERY);
  expect(mutant).not.toBe(AGENT_TASK_DETAIL_QUERY);
  expect(mutant).not.toMatch(line);
  return mutant;
};

describe('TaskExternalId', () => {
  it('renders an http(s) id as a safe link', () => {
    const out = html('https://github.com/o/r/issues/7');
    expect(out).toMatch(/<a [^>]*href="https:\/\/github\.com\/o\/r\/issues\/7"/);
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('renders any other text as text, never a link', () => {
    for (const id of ['JIRA-42', 'javascript:alert(1)', 'hrn:node:a:b:c', 'ftp://x/y']) {
      const out = html(id);
      expect(out).not.toContain('<a ');
      expect(out).toContain(id.replace(/&/g, '&amp;'));
    }
  });

  it('renders nothing for null or blank', () => {
    expect(html(null).replace(/<!--.*?-->/g, '').trim()).toBe('');
    expect(html('  ').replace(/<!--.*?-->/g, '').trim()).toBe('');
  });

  it('is selected by the detail query', () => {
    expect(selectsExternalId(AGENT_TASK_DETAIL_QUERY)).toBe(true);
  });

  // portal#1680. The word survives in each of these, so only the structure tells them from the real query.
  it.each([
    ['moved into a comment', (q: string) => q.replace(/^(\s*)externalId$/m, '$1# externalId')],
    ['aliased', (q: string) => q.replace(/^(\s*)externalId$/m, '$1x: externalId')],
    [
      'nested under another field',
      (q: string) =>
        q.replace(/^\s*externalId\n/m, '').replace('result { outcome summary evidence }', 'result { outcome summary evidence externalId }'),
    ],
  ])('does not count externalId %s as selected', (_name, rewrite) => {
    const mutant = mutate(rewrite);
    expect(mutant).toMatch(/\bexternalId\b/);
    expect(selectsExternalId(mutant)).toBe(false);
  });

  it('does not count a query without externalId as selected', () => {
    const mutant = mutate(q => q.replace(/^\s*externalId\n/m, ''));
    expect(mutant).not.toMatch(/\bexternalId\b/);
    expect(selectsExternalId(mutant)).toBe(false);
  });
});
