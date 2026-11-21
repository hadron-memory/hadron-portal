import {it,expect,vi} from 'vitest';
import {superValidate} from 'sveltekit-superforms/server';
import {zod4} from 'sveltekit-superforms/adapters';
import {mountComponent,tick} from '$lib/test/mountComponent';
import {submitEnhancedWithResult,resetKitAppliedResults} from '$lib/test/stubs/app-forms';
import {viewStorageErrorText} from '$lib/test/viewStorageErrorText';
import {viewStorageErrorMessages} from '$lib/table/viewStore';
import {savedViewsStrings} from '$lib/i18n/saved-views-strings';
import {createAppMemorySchema} from './schema';
import AppMemories from './AppMemories.svelte';
import AppMemoryCreate from './AppMemoryCreate.svelte';

it('a success identifies and links the created memory, and keeps the form open to show it',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const created={id:'new-id',urn:'hrn:mem:acme.com:new-notes',name:'New notes'};
 const posted={...initial,posted:true,message:{type:'success' as const,text:'Memory created.',created}};
 const m=mountComponent(AppMemoryCreate as never,{initial,result:{form:posted}} as never);
 try{await tick();const result=m.target.querySelector('[role=status]')!;
 expect(m.target.querySelector('details')!.open).toBe(true);
 expect(result.textContent).toContain('New notes');
 expect(result.querySelector('a')?.getAttribute('href')).toBe('/app/memories/new-id');
 expect(result.querySelector('[title="hrn:mem:acme.com:new-notes"]')).not.toBeNull();
 }finally{m.unmount();}
});

// portal#2366 (BLIND F2 of #2363): the test above MOUNTS with a success result
// already present, so it never crosses the transition. This one starts from a
// collapsed form, opens it, drives the recorded enhanced submit, hands it the
// success result the server would send, and watches the SAME mounted form.
it('an enhanced submit that succeeds keeps the opened form open and shows the created memory',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const created={id:'new-id',urn:'hrn:mem:acme.com:new-notes',name:'New notes'};
 const m=mountComponent(AppMemoryCreate as never,{initial,result:null} as never);
 try{await tick();
 const details=m.target.querySelector('details')!;
 expect(details.open).toBe(false);
 // portal#2379: the live region EXISTS and is EMPTY before the result; the result lands in that same element.
 const region=m.target.querySelector('[role=status]');
 expect(region).not.toBeNull();
 expect(region!.textContent!.trim()).toBe('');
 details.open=true;details.dispatchEvent(new Event('toggle'));await tick();
 expect(details.open).toBe(true);
 const name=m.target.querySelector<HTMLInputElement>('input[name=name]')!;
 name.value='New notes';name.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 const form=m.target.querySelector('form')!;
 const posted={...initial,valid:true,posted:true,data:{...initial.data,name:'New notes'},message:{type:'success' as const,text:'Memory created.',created}};
 const {cancelled}=await submitEnhancedWithResult(form,{type:'success',status:200,data:{form:posted}});
 expect(cancelled).toBe(false);
 await tick(3);
 const result=m.target.querySelector('[role=status]');
 expect(result).toBe(region);
 expect(result!.textContent).toContain('New notes');
 expect(result!.querySelector('a')?.getAttribute('href')).toBe('/app/memories/new-id');
 expect(result!.querySelector('[title="hrn:mem:acme.com:new-notes"]')).not.toBeNull();
 // the control: the form this result landed in is still the one the reader opened
 expect(m.target.querySelector('details')).toBe(details);
 expect(details.open).toBe(true);
 }finally{m.unmount();resetKitAppliedResults();}
});

it('the create form is collapsed until asked for, and says so in its caption',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const m=mountComponent(AppMemoryCreate as never,{initial,result:null} as never);
 try{await tick();
 const details=m.target.querySelector('details')!;
 expect(details.open).toBe(false);
 expect(details.querySelector('summary')!.textContent).toContain('Add a memory');
 expect(details.querySelector('input[name=name]')).not.toBeNull();
 }finally{m.unmount();}
});

it('a submission that failed validation keeps the form open on its error',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const failed={...initial,valid:false,posted:true,errors:{name:['Name is required']}};
 const m=mountComponent(AppMemoryCreate as never,{initial,result:{form:failed}} as never);
 try{await tick();
 expect(m.target.querySelector('details')!.open).toBe(true);
 expect(m.target.textContent).toContain('Name is required');
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
 // landed or time out loudly. The predicate waits on the ONE claim only the
 // restore can make visible — the saved globalFilter hiding Second. The
 // Description-header claim is asserted after the poll instead: it is true
 // from mount (this list never had the column), so waiting on it too would
 // dilute the poll, not guard it.
 await vi.waitFor(async()=>{
  await tick();
  expect(m!.target.textContent).not.toContain('Second');
 });
 const headers=[...m.target.querySelectorAll('th')].map(h=>h.textContent?.trim());
 expect(headers.some(h=>h?.startsWith('Description'))).toBe(false);
 expect(headers.some(h=>h?.startsWith('Name'))).toBe(true);
 expect(m.target.textContent).toContain('First');   // the row the view keeps
 expect(m.target.textContent).not.toContain('Second'); // positive control: the restore ran
 // No storage/restore error surfaced. Keyed on the shared
 // viewStorageErrorText regex — the ViewStorageError message family plus
 // ViewTabs.run's generic catch-all — BUILT from the same constants the
 // store throws, so a reworded message rides along with the regex instead
 // of silently emptying this match (the join is pinned in viewStore.test.ts).
 // That this text is really what a storage failure renders into THIS tree is
 // proven by the positive control in the test below; an uncaught throw fails
 // the awaited waitFor above loudly — both surfaces covered.
 expect(m.target.textContent).not.toMatch(viewStorageErrorText);
 }finally{m?.unmount();localStorage.removeItem('hadron:views:v1:app-memories');}
});

// portal#1625 BLIND delta-2 P2: the positive control for the not.toMatch
// above. A negative regex match can silently assert nothing the day the
// error stops reaching this text (a different error surface, a toast outside
// the tree, the render dropped). Mount with a setItem that throws, save a
// view through the real strip (+ New view → prompt), and prove a storage
// failure surfaces as text the SAME shared regex matches in THIS component's
// render tree — no testid or console.error hook needed.
it('renders the storage-error family text when saving a view fails',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const memories=[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',description:null,appId:'a'}];
 const setItem=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('QuotaExceededError');});
 const prompt=vi.spyOn(window,'prompt').mockReturnValue('My view');
 let m:ReturnType<typeof mountComponent>|undefined;
 try{
 m=mountComponent(AppMemories as never,{initial,result:null,memories,canCreate:false,showDescription:false} as never);
 await tick(2); // let ViewTabs init settle before driving the strip
 const newView=[...m.target.querySelectorAll('button')].find(b=>b.textContent?.trim()===savedViewsStrings.newView());
 expect(newView).toBeDefined();
 newView!.click();
 await vi.waitFor(async()=>{
  await tick();
  expect(m!.target.textContent).toMatch(viewStorageErrorText);
 });
 // and specifically the write-failure message ViewTabs renders verbatim,
 // not some unrelated red text the regex happened to graze
 expect(m.target.textContent).toContain(viewStorageErrorMessages.saveFailed);
 }finally{m?.unmount();prompt.mockRestore();setItem.mockRestore();}
});

// portal#2379: a failed create lands in the always-mounted alert region, not a status one.
it('an enhanced submit that fails lands in the alert region that was already mounted and empty',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const m=mountComponent(AppMemoryCreate as never,{initial,result:null} as never);
 try{await tick();
 const alertRegion=m.target.querySelector('[role=alert]');
 expect(alertRegion).not.toBeNull();
 expect(alertRegion!.textContent!.trim()).toBe('');
 const details=m.target.querySelector('details')!;details.open=true;details.dispatchEvent(new Event('toggle'));await tick();
 const posted={...initial,valid:false,posted:true,message:{type:'error' as const,text:'Could not create the memory.'}};
 await submitEnhancedWithResult(m.target.querySelector('form')!,{type:'failure',status:400,data:{form:posted}});
 await tick(3);
 expect(m.target.querySelector('[role=alert]')).toBe(alertRegion);
 expect(alertRegion!.textContent).toContain('Could not create the memory.');
 expect(m.target.querySelector('[role=status]')!.textContent!.trim()).toBe('');
 }finally{m.unmount();resetKitAppliedResults();}
});
