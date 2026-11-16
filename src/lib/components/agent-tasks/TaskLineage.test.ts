/**
 * portal#2161 — the lineage link on a clone's page (cor:agt:050:02): "Replaces
 * <handle> <title>" when the source has ended (finished or cancelled —
 * replacing an ended task is what a clone is for), "Cloned from <handle>
 * <title>" otherwise. A null clonedFrom (not a clone, or a source this caller
 * can't read) renders nothing at all — no placeholder (cor:acl:110:02).
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskLineage from './TaskLineage.svelte';

const basePath = '/app/apps/app-1';
const source = (status: string) => ({ id: 'src-1', handle: 'AT3.1', title: 'First', status });
const html = (clonedFrom: unknown) =>
  render(TaskLineage as never, { props: { clonedFrom, basePath } } as never).body;

describe('TaskLineage (acceptance 7)', () => {
  it.each(['FINISHED', 'CANCELLED'] as const)('a %s source reads "Replaces <handle> <title>"', (status) => {
    const out = html(source(status));
    expect(out).toContain('Replaces AT3.1 First');
    expect(out).not.toContain('Cloned from');
    expect(out).toMatch(/href="\/app\/apps\/app-1\/tasks\/AT3\.1"/);
  });

  it('a live source reads "Cloned from <handle> <title>"', () => {
    const out = html(source('STARTED'));
    expect(out).toContain('Cloned from AT3.1 First');
    expect(out).not.toContain('Replaces');
  });

  it('a null clonedFrom renders nothing at all — no placeholder', () => {
    const out = html(null);
    // Only SSR anchor comments may remain — no element, no text.
    expect(out).not.toMatch(/<(a|dt|dd|span|p)\b/);
    expect(out).not.toContain('Cloned from');
    expect(out).not.toContain('Replaces');
    expect(out).not.toContain('hidden');
  });
});
