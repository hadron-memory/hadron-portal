import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FlowScriptMarker from './FlowScriptMarker.svelte';

const html = (script: unknown) => render(FlowScriptMarker, { props: { script } as never }).body;

describe('FlowScriptMarker (#1597)', () => {
  it('shows the script marker, tool and arg keys', () => {
    const out = html({ tool: 'hadron_find_nodes', argKeys: ['query'], bothBodies: false });
    expect(out).toContain('Script');
    expect(out).toContain('hadron_find_nodes');
    expect(out).toContain('query');
    expect(out).not.toContain('role="alert"');
  });

  it('warns when the node carries both bodies', () => {
    expect(html({ tool: 't', argKeys: [], bothBodies: true })).toContain('role="alert"');
  });

  it('says so when the call has no tool', () => {
    expect(html({ tool: null, argKeys: [], bothBodies: false })).toContain('no tool');
  });
});
