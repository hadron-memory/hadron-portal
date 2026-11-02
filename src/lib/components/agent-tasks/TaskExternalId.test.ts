/**
 * portal#1607 — a task's externalId (hadron-server#3137, hrn:node:hadronmemory.com:specs:cor:agt:120:02) on the
 * detail page: a link for an http(s) URL, text for anything else, nothing for null.
 * Display only: it is set once, when the task is created.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskExternalId from './TaskExternalId.svelte';
import { AGENT_TASK_DETAIL_QUERY } from '$lib/server/queries';

const html = (externalId: string | null) => render(TaskExternalId, { props: { externalId } }).body;

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
    expect(AGENT_TASK_DETAIL_QUERY).toMatch(/\bexternalId\b/);
  });
});
