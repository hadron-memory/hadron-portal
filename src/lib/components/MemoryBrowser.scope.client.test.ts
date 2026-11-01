import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';
let m: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { m?.unmount(); vi.unstubAllGlobals(); });
const node = (memoryId: string, name: string) => ({ id: `${memoryId}-node`, memoryId, memory: null, urn: `hrn:node:example.com:${memoryId}:note`, loc: 'note', name, nodeType: 'info', tags: [], seq: null, isRunnable: false, description: null });
it('joins withheld nested records by memoryId for filter chips without fetching Memory or Agent records', async () => {
 const requests: string[] = [];
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  requests.push(url);
  if(url === '/api/nodes/columns') return new Response(JSON.stringify({rows:[],unavailable:JSON.parse(String(init?.body)).refs,omitted:[]}));
  throw new Error(`Unexpected per-row request ${url}`);
 }));
 const props=reactiveProps<Record<string,unknown>>({nodes:[node('first','First node'),node('role','Role node'),node('unknown','Unscoped node')],multiMemory:true,forcedView:'nodes',scopeMemories:[{memoryId:'first',memoryUrn:'hrn:mem:example.com:first',name:'First memory'},{memoryId:'role',memoryUrn:'hrn:mem:example.com:role',name:'Role memory'}]});
 m=mountComponent(MemoryBrowser as never,props as never) as Mounted<Record<string,unknown>>;
 await tick(5);
 expect(m.target.querySelector('[title="hrn:node:example.com:unknown:note"]')).toBeTruthy();
 const menu=[...m.target.querySelectorAll('button')].find(b=>b.textContent?.trim().startsWith('Memories'))!;
 expect(menu).toBeTruthy();menu.click();await tick(2);
 const role=[...m.target.querySelectorAll('label')].find(b=>b.textContent?.trim()==='Role memory')!.querySelector('input')!;
 expect(role).toBeTruthy();role.click();await tick(3);
 expect(m.target.textContent).toContain('Role node');expect(m.target.textContent).not.toContain('First node');
 expect(requests.every(url=>url==='/api/nodes/columns')).toBe(true);
 // Updating scope identity must update the same mounted component too.
 props.scopeMemories=[{memoryId:'first',memoryUrn:'hrn:mem:example.com:first',name:'First memory'},{memoryId:'role',memoryUrn:'hrn:mem:example.com:role',name:'Renamed role'}];await tick(3);
 expect(m.target.textContent).toContain('Renamed role');
});
