/**
 * portal#1649 — the rows and the page's claims, in server-rendered markup:
 * the code on every row in every state, no link for UNMAPPED, the role view's
 * exact-taskUrn rule, "No codes shown" with no reason, and what each page says
 * about the whole list.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ActionRegisterList from './ActionRegisterList.svelte';
import type { RegisterEntry } from '$lib/action-register/present';

const here = 'hrn:node:acme.com:team:tasks:build';
const other = 'hrn:node:acme.com:child:tasks:build';
const entries: RegisterEntry[] = [
  { code: 'build.ready', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: here, definedBy: 'hrn:agent:acme.com:team' },
  { code: 'build.override', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: other, definedBy: null },
  { code: 'build.gone', state: 'UNRESOLVED', taskLoc: 'tasks:missing', taskUrn: null },
  { code: 'build.bad', state: 'UNMAPPED', taskLoc: null, taskUrn: null },
];
const html = (props: Record<string, unknown>) =>
  render(ActionRegisterList as never, { props: { offset: 0, limit: 20, hrefFor: (o: number) => `?offset=${o}`, listKey: 'k', ...props } as never }).body;

describe('rows', () => {
  const out = html({ page: { entries, total: 4, hasMore: false } });
  it('shows the code on every row in every state', () => {
    for (const e of entries) expect(out).toContain(e.code);
  });
  it('UNRESOLVED says no runnable task at the returned loc; UNMAPPED says malformed and carries no link', () => {
    expect(out).toContain('No runnable task at tasks:missing');
    expect(out).toContain('The nearest register entry for this code is malformed');
    const unmappedRow = out.split('register-row-unmapped')[1].split('</tr>')[0];
    expect(unmappedRow).not.toContain('href=');
  });
  it('in the App view a MAPPED row shows its loc and links its taskUrn', () => {
    expect(out).toContain('tasks:build');
    expect(out).toContain(`href="/app/u/${here}"`);
  });
});

describe('role view', () => {
  const out = html({ page: { entries: entries.slice(0, 2), total: 2, hasMore: false }, definitionUrn: here });
  it('only the exact taskUrn says it sends work here; another taskUrn is labelled as resolving elsewhere', () => {
    expect(out.match(/Sends work here/g)).toHaveLength(1);
    expect(out).toContain('Resolves to another task');
    expect(out.split('Resolves to another task')[0].match(/Sends work here/g)).toHaveLength(1);
  });
});

describe('empty and paging', () => {
  it('an empty page says "No codes shown" and gives no reason', () => {
    const out = html({ page: { entries: [], total: 0, hasMore: false } });
    expect(out).toContain('No codes shown');
    expect(out).not.toMatch(/no Team Agent|ambiguous|not readable|no mapping/i);
  });
  it('an offset past the end is an empty page with Previous, not "none"', () => {
    const out = html({ page: { entries: [], total: 45, hasMore: false }, offset: 200 });
    expect(out).toContain('No codes shown');
    expect(out).toContain('?offset=180');
  });
  it('shows total and Next from hasMore; the first page never offers Previous', () => {
    const out = html({ page: { entries, total: 45, hasMore: true } });
    expect(out).toContain('Showing 1–4 of 45');
    expect(out).toContain('?offset=20');
    expect(out).not.toContain('rel="prev"');
  });
  it('a later final page offers Previous and no Next, and does not claim to be the whole list', () => {
    const out = html({ page: { entries, total: 24, hasMore: false }, offset: 20 });
    expect(out).toContain('Showing 21–24 of 24');
    expect(out).toContain('rel="prev"');
    expect(out).not.toContain('rel="next"');
  });
});
