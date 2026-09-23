/**
 * #879 — the Task Nodes row checkbox, mounted.
 *
 * CLIENT lane because what matters is the FormData a real submission carries,
 * and a server render never builds one
 * (`review:submitted-value-must-not-be-written-on-click`). Each row is its own
 * form whose two values are literals from the loader — so the assertions read
 * `new FormData(form)` after a microtask, never an input's `.value`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import type { TaskExport } from '$lib/skill-export';
import TaskExportToggle from './TaskExportToggle.svelte';

type Props = { nodeId: string; memoryId: string; name: string; exportState: TaskExport };

const mounted: Array<Mounted<Props>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function row(props: Props) {
  const m = mountComponent(TaskExportToggle, props);
  mounted.push(m);
  return m;
}

function submitted(target: HTMLElement): Record<string, string> {
  const form = target.querySelector('form');
  if (!form) throw new Error('no form rendered');
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
}

const base = { memoryId: 'mem-1', name: 'Drive PR home' };

describe('TaskExportToggle — what the row submits', () => {
  it('an unchecked row asks to turn the export ON, for its own node', async () => {
    const { target } = row({ ...base, nodeId: 'n1', exportState: { kind: 'none' } });
    await tick();
    expect(submitted(target)).toEqual({ nodeId: 'n1', enable: 'true' });
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it('a checked row asks to turn it OFF', async () => {
    const { target } = row({ ...base, nodeId: 'n2', exportState: { kind: 'on', hosts: ['claudeSkill', 'codexSkill'] } });
    await tick();
    expect(submitted(target)).toEqual({ nodeId: 'n2', enable: 'false' });
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it('many rows are many forms — each carries only its own node', async () => {
    const a = row({ ...base, nodeId: 'a', exportState: { kind: 'off' } });
    const b = row({ ...base, nodeId: 'b', exportState: { kind: 'on', hosts: ['claudeSkill', 'codexSkill'] } });
    await tick();
    expect(submitted(a.target)).toEqual({ nodeId: 'a', enable: 'true' });
    expect(submitted(b.target)).toEqual({ nodeId: 'b', enable: 'false' });
  });

  it('after the reload flips the stored state, the SAME row asks for the opposite', async () => {
    // The row component is reused across `invalidateAll`; the literal must
    // follow the new data or a second click would repeat the first.
    const props = reactiveProps<Props>({ ...base, nodeId: 'n1', exportState: { kind: 'off' } });
    const { target } = row(props);
    await tick();
    expect(submitted(target).enable).toBe('true');
    props.exportState = { kind: 'on', hosts: ['claudeSkill', 'codexSkill'] };
    await tick();
    expect(submitted(target).enable).toBe('false');
  });
});

describe('TaskExportToggle — states the checkbox must not flatten', () => {
  it('a divergent row offers NO checkbox and no form — only the way to the node', async () => {
    const { target } = row({ ...base, nodeId: 'n1', exportState: { kind: 'divergent' } });
    await tick();
    expect(target.querySelector('form')).toBeNull();
    expect(target.querySelector('input[type="checkbox"]')).toBeNull();
    const link = target.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/app/memories/mem-1/nodes/n1/edit');
    expect(link.textContent).toBe('Differs per host');
  });

  it('a single-host export stays checkable, and says which host it covers', async () => {
    const { target } = row({ ...base, nodeId: 'n1', exportState: { kind: 'on', hosts: ['claudeSkill'] } });
    await tick();
    expect(submitted(target)).toEqual({ nodeId: 'n1', enable: 'false' });
    expect(target.textContent).toContain('Claude only');
  });

  it('a two-host export renders no note, so its search text is empty too', async () => {
    const { target } = row({ ...base, nodeId: 'n1', exportState: { kind: 'on', hosts: ['claudeSkill', 'codexSkill'] } });
    await tick();
    expect(target.textContent?.trim()).toBe('');
  });
});
