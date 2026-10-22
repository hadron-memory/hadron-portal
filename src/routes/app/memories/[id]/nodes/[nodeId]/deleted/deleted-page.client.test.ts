import { describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import DeletedPage from './+page.svelte';

const node = {
  id: 'pk',
  urn: 'hrn:node:acme.com:notes:office-facts',
  memoryId: 'mem-1',
  loc: 'office-facts',
  name: 'Office Facts',
  nodeType: 'info',
  description: 'About the office',
  deletedAt: '2026-10-19T10:00:00.000Z',
  content: 'The body',
};

describe('deleted node page (#1159)', () => {
  it('marks the node deleted, shows its URN and body, and offers Restore', () => {
    const { target, unmount } = mountComponent(DeletedPage as never, { data: { node }, form: null } as never);
    expect(target.textContent).toContain('Office Facts');
    expect(target.textContent).toContain('Deleted');
    expect(target.textContent).toContain('office-facts');
    expect(target.textContent).toContain('The body');
    const restore = target.querySelector<HTMLFormElement>('form[action="?/restore"]');
    expect(restore?.querySelector('button[type=submit]')?.textContent).toContain('Restore node');
    unmount();
  });

  it('shows a refusal as an alert next to the button', () => {
    const { target, unmount } = mountComponent(
      DeletedPage as never,
      { data: { node }, form: { error: 'Restore the deleted ancestor first.' } } as never,
    );
    expect(target.querySelector('[role=alert]')?.textContent).toContain('Restore the deleted ancestor first.');
    unmount();
  });

  it('omits the body and description blocks when there are none', () => {
    const { target, unmount } = mountComponent(
      DeletedPage as never,
      { data: { node: { ...node, content: null, description: null } }, form: null } as never,
    );
    expect(target.querySelector('pre')).toBeNull();
    unmount();
  });
});
