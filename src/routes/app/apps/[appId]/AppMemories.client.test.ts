import {it,expect,vi} from 'vitest';
import {superValidate} from 'sveltekit-superforms/server';
import {zod4} from 'sveltekit-superforms/adapters';
import {mountComponent,tick} from '$lib/test/mountComponent';
import {createAppMemorySchema} from './schema';
import AppMemories from './AppMemories.svelte';

it('a success identifies and links the created memory even when its row is outside the visible list',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const created={id:'new-id',urn:'hrn:mem:acme.com:new-notes',name:'New notes'};
 const posted={...initial,posted:true,message:{type:'success' as const,text:'Memory created.',created}};
 const memories=Array.from({length:11},(_,i)=>({id:`m${i}`,urn:`hrn:mem:acme.com:m${i}`,name:`Existing ${i}`,description:null,appId:'a'}));
 const m=mountComponent(AppMemories as never,{initial,result:{form:posted},memories,canCreate:true} as never);
 try{await tick();const result=m.target.querySelector('[role=status]')!;
 expect(result.textContent).toContain('New notes');
 expect(result.querySelector('a')?.getAttribute('href')).toBe('/app/memories/new-id');
 expect(result.querySelector('[title="hrn:mem:acme.com:new-notes"]')).not.toBeNull();
 }finally{m.unmount();}
});

// #1451 Ask 2: a user-owned App's rows come from appMemoryScope, which carries
// no description, so the column would show a dash for a memory that has one.
it.each([[true,true],[false,false]])('showDescription=%s puts the Description column in the table: %s',async(showDescription,present)=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 // non-null description so the present direction proves the column renders
 // data, not just a header, and the absent direction catches a data leak
 const memories=[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',description:'a note',appId:'a'}];
 const m=mountComponent(AppMemories as never,{initial,result:null,memories,canCreate:false,showDescription} as never);
 try{await tick();
 const headers=[...m.target.querySelectorAll('th')].map(h=>h.textContent?.trim());
 expect(headers.some(h=>h?.startsWith('Description'))).toBe(present);
 expect(headers.some(h=>h?.startsWith('Name'))).toBe(true);
 expect(m.target.textContent).toContain('First');
 if(present)expect(m.target.textContent).toContain('a note');
 else expect(m.target.textContent).not.toContain('a note');
 }finally{m.unmount();}
});

// portal#1469 (BLIND P3-6): listKey "app-memories" is shared, but a
// user-owned App has no Description column. A view saved on an org App names
// `description` in its visibility, order and sizing; restoring it here must
// be tolerated — the grid still renders its own columns, the strip shows no
// storage error, and nothing throws out of the view restore. The view also
// carries a globalFilter naming First, so the restore is PROVEN to have run:
// a store that read nothing would leave Second visible and pass vacuously.
it('restores a saved view that names the absent Description column (user-owned App)',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const memories=[
  {id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',description:null,appId:'a'},
  {id:'m2',urn:'hrn:mem:acme.com:m2',name:'Second',description:null,appId:'a'},
 ];
 const staleView={sorting:[],columnFilters:[],globalFilter:'First',
  columnVisibility:{description:false},columnOrder:['description','name','urn'],columnSizing:{description:360,name:220},
  pagination:{pageIndex:0,pageSize:25}};
 localStorage.setItem('hadron:views:v1:app-memories',JSON.stringify([
  {id:'v1',listKey:'app-memories',name:'Org era',view:staleView,isDefault:true,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z'},
 ]));
 // try starts before mount: a throwing mount must still clear storage.
 let m:ReturnType<typeof mountComponent>|undefined;
 try{
 m=mountComponent(AppMemories as never,{initial,result:null,memories,canCreate:false,showDescription:false} as never);
 // init() awaits the view list, then the active id, before applyView lands.
 // Poll to the restored state rather than counting ticks: a fixed count
 // either outgrows the chain into a false red or reads a not-yet-filtered
 // table and passes vacuously, and waitFor can only pass when the restore
 // landed or time out loudly. The predicate carries every restore-visible
 // claim (filter narrowed AND stale column still absent) so no post-poll
 // assertion can race a later applyView step.
 await vi.waitFor(async()=>{
  await tick();
  expect(m!.target.textContent).not.toContain('Second');
  const h=[...m!.target.querySelectorAll('th')].map(x=>x.textContent?.trim()??'');
  expect(h.some(x=>x.startsWith('Description'))).toBe(false);
 });
 const headers=[...m.target.querySelectorAll('th')].map(h=>h.textContent?.trim());
 expect(headers.some(h=>h?.startsWith('Name'))).toBe(true);
 expect(m.target.textContent).toContain('First');   // the row the view keeps
 expect(m.target.textContent).not.toContain('Second'); // positive control: the restore ran
 // No storage/restore error surfaced. Keyed on the full rendered error
 // family rather than styling: the ViewStorageError constructor messages
 // plus ViewTabs.run's generic catch-all for any other throw
 // (saved-views.error.update, "Could not update views."). A class or
 // testid query asserts nothing if the error surface is restyled, while
 // rewording any family member turns the mapping pin in viewStore.test.ts
 // red instead of silently emptying this match. Throws caught by
 // ViewTabs.run render as this text; an uncaught throw fails the awaited
 // waitFor above loudly — both surfaces covered.
 expect(m.target.textContent).not.toMatch(/Could not (save|update)|Storage is unavailable|View not found|View name cannot be empty/);
 }finally{m?.unmount();localStorage.removeItem('hadron:views:v1:app-memories');}
});
