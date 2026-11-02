import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FlowScriptMarker from './FlowScriptMarker.svelte';
import type { FlowCanvasScript } from '$lib/flow/canvas';

const html = (script: FlowCanvasScript) => render(FlowScriptMarker, { props: { script } }).body;

describe('FlowScriptMarker (#1597)', () => {
  it('shows the script marker, tool and arg keys', () => {
    const out = html({ tool: 'hadron_find_nodes', argKeys: ['query'], bothBodies: false, argsInvalid: false });
    expect(out).toContain('Script');
    expect(out).toContain('hadron_find_nodes');
    expect(out).toContain('query');
    expect(out).not.toContain('role="alert"');
  });

  it('warns when the node carries both bodies', () => {
    expect(html({ tool: 't', argKeys: [], bothBodies: true, argsInvalid: false })).toContain('role="alert"');
  });

  it('says so when the call has no tool', () => {
    expect(html({ tool: null, argKeys: [], bothBodies: false, argsInvalid: false })).toContain('no tool');
  });

  it('warns when call.args is present and not a plain object', () => {
    const out = html({ tool: 't', argKeys: [], bothBodies: false, argsInvalid: true });
    expect(out).toContain('role="alert"');
    expect(out).toContain('refuses this node when the flow loads');
  });

  it('shows no warning for valid args', () => {
    expect(html({ tool: 't', argKeys: ['q'], bothBodies: false, argsInvalid: false })).not.toContain('role="alert"');
  });
});
