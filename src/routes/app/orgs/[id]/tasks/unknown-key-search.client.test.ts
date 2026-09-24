/**
 * server#1296 — the Task Nodes grid finds a row by its unused-key note.
 *
 * CLIENT lane: the search box filters a mounted grid, which a server render
 * never builds. The note is rendered by the export cell, so the column's
 * accessor must carry it too
 * (`hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable`);
 * a pure test of the helper cannot see which helper the page wires in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import type { TaskExport } from '$lib/skill-export';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const task = (id: string, name: string, exp: TaskExport) => ({
  id,
  memoryId: 'mem-1',
  loc: `tasks:${id}`,
  name,
  description: `${name} description`,
  urn: `hrn:node:acme.com:ops:tasks:${id}`,
  export: exp,
});

function mountPage() {
  setStubPage('https://example.test/app/orgs/org-1/tasks', { id: 'org-1' });
  const m = mountComponent(Page as never, {
    data: {
      org: { id: 'org-1', name: 'Acme' },
      tasks: [
        task('typo', 'Typo task', { kind: 'none', unknown: { count: 1, sample: ['codex'] } }),
        task('plain', 'Plain task', { kind: 'none' }),
      ],
      failed: false,
      truncated: false,
    },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

async function search(target: HTMLElement, text: string) {
  const box = target.querySelector<HTMLInputElement>('input[aria-label="Search tasks"]')!;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
}

const names = (t: HTMLElement) =>
  [...t.querySelectorAll('tbody tr')].map((r) => r.querySelector('a[href^="/app/u/"]')?.textContent?.trim());

describe('Task Nodes — searching the unused-key note (server#1296)', () => {
  it('finds the row by the note its export cell renders, and only that row', async () => {
    const { target } = mountPage();
    await tick(2);
    // Positive control: both rows render, and the note is on screen.
    expect(names(target)).toEqual(expect.arrayContaining(['Typo task', 'Plain task']));
    expect(target.textContent).toContain('Unused key: codex');

    await search(target, 'unused key');
    expect(names(target)).toEqual(['Typo task']);
  });
});
