import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import TaskReferencesEditor from '$lib/components/agent-tasks/TaskReferencesEditor.svelte';
import type { MemoriesRead } from '$lib/node-choices';

/**
 * portal#2344 / #2377 slice 4: 'Loading your memories…' (the lazy memories read behind the node picker) is a
 * persistent LiveRegion: it exists, empty, before the picker opens; holds the text while the read runs; and is the
 * same element, empty, once the read lands.
 */
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
let layoutSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => { layoutSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100); });
afterEach(() => { layoutSpy?.mockRestore(); layoutSpy = null; });

it('the memories loading line is announced by a region that is the same element before, during and after the read', async () => {
  let resolve!: (r: MemoriesRead) => void;
  const loadMemories = vi.fn(() => new Promise<MemoriesRead>((r) => { resolve = r; }));
  const m = mountComponent(TaskReferencesEditor as never, {
    app: { id: 'app-1', urn: 'hrn:app:example.com:app-1' },
    nodeMemories: { kind: 'ok', value: [] },
    loadMemories,
    initial: [],
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  const target = m.target;
  const select = target.querySelector('select')!;
  select.value = 'NODE';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();

  const idle = idleStatusRegions(target);
  expect(idle.length, 'regions exist, empty, before the picker opens').toBeGreaterThan(0);
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Choose a node…')!.click();
  await tick(3);
  expect(loadMemories).toHaveBeenCalledOnce();
  const speaking = [...target.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => r.textContent?.trim() === 'Loading your memories…');
  expect(speaking).toHaveLength(1);
  expect(idle, 'the speaking region already existed').toContain(speaking[0]);

  resolve({ kind: 'ok', value: [{ id: 'm1', name: 'Mem', urn: 'hrn:mem:example.com:mem' }] });
  await tick(5);
  expect(speaking[0].isConnected).toBe(true);
  expect(speaking[0].textContent?.trim()).toBe('');
});
