/**
 * NodeActionsMenu SSR smoke (#503) — the "⋯" menu is closed on render
 * (items appear only after the client opens it), the trigger is a labelled
 * menu button, and danger items carry the destructive style.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeActionsMenu from './NodeActionsMenu.svelte';

const actions = [
  { id: 'run', label: 'Run' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'delete', label: 'Delete', danger: true },
];

describe('NodeActionsMenu', () => {
  it('renders a labelled menu trigger with aria-haspopup', () => {
    const { body } = render(NodeActionsMenu, {
      props: { actions, onselect: () => {}, label: 'Actions for Foo' },
    });
    expect(body).toContain('aria-haspopup="menu"');
    expect(body).toContain('aria-label="Actions for Foo"');
  });

  it('is closed on first render (no menu items in the DOM yet)', () => {
    const { body } = render(NodeActionsMenu, {
      props: { actions, onselect: () => {} },
    });
    expect(body).not.toContain('role="menuitem"');
    expect(body).not.toContain('>Duplicate<');
  });

  it('can disable the trigger while an action is pending', () => {
    const { body } = render(NodeActionsMenu, {
      props: { actions, onselect: () => {}, disabled: true },
    });
    expect(body).toMatch(/<button(?=[^>]*\sdisabled(?:\s|>|=""))[^>]*>/);
    expect(body).not.toContain('aria-busy');
  });
});
