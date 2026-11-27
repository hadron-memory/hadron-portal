import {describe,it,expect,vi} from 'vitest';
import {superValidate} from 'sveltekit-superforms/server';
import {zod4} from 'sveltekit-superforms/adapters';
import {mountComponent,tick} from '$lib/test/mountComponent';
import {submitEnhancedWithResult,resetKitAppliedResults} from '$lib/test/stubs/app-forms';
import {viewStorageErrorText} from '$lib/test/viewStorageErrorText';
import {viewStorageErrorMessages} from '$lib/table/viewStore';
import {savedViewsStrings} from '$lib/i18n/saved-views-strings';
import {createAppMemorySchema,attachAppMemorySchema,detachAppMemorySchema} from './schema';
import AppMemories from './AppMemories.svelte';
import AppMemoryCreate from './AppMemoryCreate.svelte';

async function listProps(memories:unknown,extra:Record<string,unknown>={}){
 const attachForm=await superValidate({},zod4(attachAppMemorySchema),{id:'attachAppMemory:a',errors:false});
 const detachForm=await superValidate({},zod4(detachAppMemorySchema),{id:'detachAppMemory:a',errors:false});
 return {memories,appId:'a',hasAgent:true,canCreate:true,attachForm,detachForm,result:null,...extra} as never;
}
it('a success identifies and links the created memory, and keeps the form open to show it',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const created={id:'new-id',urn:'hrn:mem:acme.com:new-notes',name:'New notes'};
 const posted={...initial,posted:true,message:{type:'success' as const,text:'Memory created.',created}};
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent:true,result:{form:posted}} as never);
 try{await tick();const result=m.target.querySelector('[role=status]')!;
 expect(m.target.querySelector('[data-testid=app-memory-create]')).not.toBeNull();
 expect(result.textContent).toContain('New notes');
 expect(result.querySelector('a')?.getAttribute('href')).toBe('/app/memories/new-id');
 expect(result.querySelector('[title="hrn:mem:acme.com:new-notes"]')).not.toBeNull();
 }finally{m.unmount();}
});

// portal#2366 (BLIND F2 of #2363): the test above MOUNTS with a success result
// already present, so it never crosses the transition. This one starts from a
// form, drives the recorded enhanced submit, hands it the
// success result the server would send, and watches the SAME mounted form.
it('an enhanced submit that succeeds keeps the same form in place and shows the created memory',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const created={id:'new-id',urn:'hrn:mem:acme.com:new-notes',name:'New notes'};
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent:true,result:null} as never);
 try{await tick();
 const section=m.target.querySelector('[data-testid=app-memory-create]')!;
 // portal#2379: the live region EXISTS and is EMPTY before the result; the result lands in that same element.
 const region=m.target.querySelector('[role=status]');
 expect(region).not.toBeNull();
 expect(region!.textContent!.trim()).toBe('');
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
 expect(m.target.querySelector('[data-testid=app-memory-create]')).toBe(section);
 }finally{m.unmount();resetKitAppliedResults();}
});

it('the create form has one title and a Close that hands control back to its opener',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const onclose=vi.fn();
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent:true,result:null,onclose} as never);
 try{await tick();
 const section=m.target.querySelector('[data-testid=app-memory-create]')!;
 expect(section.querySelectorAll('h3')).toHaveLength(1);
 expect(section.querySelector('h3')!.textContent).toContain('Add a new memory');
 expect(section.querySelector('input[name=name]')).not.toBeNull();
 [...section.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Close')!.click();
 expect(onclose).toHaveBeenCalledTimes(1);
 }finally{m.unmount();}
});

it('a submission that failed validation keeps the form open on its error',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const failed={...initial,valid:false,posted:true,errors:{name:['Name is required']}};
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent:true,result:{form:failed}} as never);
 try{await tick();
 expect(m.target.textContent).toContain('Name is required');
 }finally{m.unmount();}
});

// The list shows each memory's class beside its name; a description is no longer a column.
it('shows Name and Class columns, with each memory\'s class, and no Description',async()=>{
 const memories=[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',class:'app',appId:'a'},{id:'m2',urn:'hrn:mem:acme.com:m2',name:'Second',class:'personal',appId:'a'}];
 const m=mountComponent(AppMemories as never,await listProps(memories));
 try{await tick();
 const headers=[...m.target.querySelectorAll('th')].map(h=>h.textContent?.trim());
 expect(headers.some(h=>h?.startsWith('Name'))).toBe(true);
 expect(headers.some(h=>h?.startsWith('Class'))).toBe(true);
 expect(headers.some(h=>h?.startsWith('Description'))).toBe(false);
 const cells=[...m.target.querySelectorAll('tbody tr')].map(r=>[...r.querySelectorAll('td')].map(td=>td.textContent?.trim()));
 expect(cells[0]?.[1]).toBe('app');
 expect(cells[1]?.[1]).toBe('personal');
 }finally{m.unmount();}
});

// portal#1469 (BLIND P3-6): listKey "app-memories" is shared, but a
// user-owned App has no Description column. A view saved on an org App names
// `description` in its visibility, order and sizing; restoring it here must
// be tolerated — the grid still renders its own columns, the strip shows no
// storage error, and nothing throws out of the view restore. The view also
// carries a globalFilter naming First, so the restore is PROVEN to have run:
// a store that read nothing would leave Second visible and pass vacuously.
it('restores a saved view that names the retired Description column',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const memories=[
  {id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',class:'app',appId:'a'},
  {id:'m2',urn:'hrn:mem:acme.com:m2',name:'Second',class:'app',appId:'a'},
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
 m=mountComponent(AppMemories as never,await listProps(memories));
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
 const memories=[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',class:'app',appId:'a'}];
 const setItem=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('QuotaExceededError');});
 const prompt=vi.spyOn(window,'prompt').mockReturnValue('My view');
 let m:ReturnType<typeof mountComponent>|undefined;
 try{
 m=mountComponent(AppMemories as never,await listProps(memories));
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
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent:true,result:null} as never);
 try{await tick();
 const alertRegion=m.target.querySelector('[role=alert]');
 expect(alertRegion).not.toBeNull();
 expect(alertRegion!.textContent!.trim()).toBe('');
 const posted={...initial,valid:false,posted:true,message:{type:'error' as const,text:'Could not create the memory.'}};
 await submitEnhancedWithResult(m.target.querySelector('form')!,{type:'failure',status:400,data:{form:posted}});
 await tick(3);
 expect(m.target.querySelector('[role=alert]')).toBe(alertRegion);
 expect(alertRegion!.textContent).toContain('Could not create the memory.');
 expect(m.target.querySelector('[role=status]')!.textContent!.trim()).toBe('');
 }finally{m.unmount();resetKitAppliedResults();}
});

// portal#1391: Description is optional, and an empty one is blank, not a value.
it('says Description is optional in helper text the field is described by',async()=>{
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent:true,result:null} as never);
 try{await tick();
 const field=m.target.querySelector<HTMLTextAreaElement>('#app-memory-description')!;
 const help=m.target.querySelector(`#${field.getAttribute('aria-describedby')}`);
 expect(help?.textContent).toMatch(/^Optional\./);
 expect(m.target.querySelector('label[for="app-memory-description"]')?.textContent?.trim()).toBe('Description');
 }finally{m.unmount();}
});
// portal#2529: a submit refused with AGENT_NOT_INSTALLED answers in the same words as the page's note; show them once.
const noAgentWords='Install an Agent in this App before adding a memory.';
const occurrences=(text:string|null,sentence:string)=>text?.split(sentence).length!-1;
async function mountRefused(hasAgent:boolean,message:Record<string,unknown>){
 const initial=await superValidate({},zod4(createAppMemorySchema),{id:'createAppMemory:a',errors:false});
 const posted={...initial,data:{...initial.data,_kind:'createAppMemory',name:'Notes'},posted:true,message};
 const m=mountComponent(AppMemoryCreate as never,{initial,hasAgent,result:{form:posted}} as never);
 await tick();return m;
}
it('after a no-Agent refusal the sentence shows once, from the refusal, and the button is not described by a missing note',async()=>{
 const m=await mountRefused(false,{type:'error',text:noAgentWords,code:'AGENT_NOT_INSTALLED'});
 try{expect(occurrences(m.target.textContent,noAgentWords)).toBe(1);
 expect(m.target.querySelector('[data-testid="app-memory-needs-agent"]')).toBeNull();
 expect(m.target.querySelector('[role=alert]')?.textContent).toContain(noAgentWords);
 expect(m.target.querySelector('button[type=submit]')?.hasAttribute('aria-describedby')).toBe(false);
 }finally{m.unmount();}
});
it('a different refusal leaves the no-Agent note in place beside it',async()=>{
 const m=await mountRefused(false,{type:'error',text:'Could not create the memory. Please try again.'});
 try{expect(occurrences(m.target.textContent,noAgentWords)).toBe(1);
 const note=m.target.querySelector('[data-testid="app-memory-needs-agent"]');
 expect(note).not.toBeNull();
 expect(m.target.querySelector('button[type=submit]')?.getAttribute('aria-describedby')).toBe(note!.id);
 }finally{m.unmount();}
});

// Adding an EXISTING memory: Add memory → Choose an existing memory → the user's own memories in the shared
// picker → the attach form posts that memory through the App's primary Agent.
describe('adding an existing memory', () => {
 const rows=[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',class:'app',appId:'a'}];
 const press=async(root:Element,label:string)=>{[...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!.click();await tick(3);};
 const fetchReply=(body:unknown,ok=true)=>vi.spyOn(globalThis,'fetch').mockResolvedValue({ok,json:async()=>body} as Response);
 it('opens the picker with the user\'s memories and posts the chosen one, sending no Agent',async()=>{
  const get=fetchReply({kind:'ok',memories:[{id:'mine',urn:'hrn:mem:acme.com:mine',name:'My notes',visibility:'ORGANIZATION'}]});
  // the values the POST would carry, read when the submit happens, not after
  const posted:Record<string,string>[]=[];
  const submit=vi.spyOn(HTMLFormElement.prototype,'requestSubmit').mockImplementation(function(this:HTMLFormElement){posted.push(Object.fromEntries(new FormData(this) as never));});
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  await press(m.target,'Add memory');
  await press(document.body,'Choose an existing memory');
  await vi.waitFor(()=>expect(document.body.textContent).toContain('My notes'));
  expect(get.mock.calls[0][0]).toBe('/app/apps/a/attachable');
  await press(document.body,'Select');
  await vi.waitFor(()=>expect(submit).toHaveBeenCalled());
  expect(posted[0]).toMatchObject({memoryId:'mine',_kind:'attachAppMemory'});
  expect(posted[0]).not.toHaveProperty('agentId');
  const form=m.target.querySelector<HTMLFormElement>('form[action="?/attachMemory"]')!;
  expect(form.querySelector<HTMLInputElement>('input[name=memoryId]')!.value).toBe('mine');
  expect(form.querySelector('input[name=agentId]')).toBeNull();
  expect(form.querySelector<HTMLInputElement>('input[name=_kind]')!.value).toBe('attachAppMemory');
  }finally{m.unmount();get.mockRestore();submit.mockRestore();}
 });
 it('says so, and opens no picker, when the user\'s memories could not be read',async()=>{
  const get=fetchReply({kind:'failed'});
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  await press(m.target,'Add memory');
  await press(document.body,'Choose an existing memory');
  await vi.waitFor(()=>expect(m.target.textContent).toContain('Could not load your memories'));
  expect(document.body.querySelector('[aria-label="Choose a memory"]')).toBeNull();
  }finally{m.unmount();get.mockRestore();}
 });
 // portal#2635: an attach is a link, and the server ignores the Agent (agentRef is optional and ignored).
 it('offers the attach choice and opens the picker while the App has no Agent; only creating needs one',async()=>{
  const get=fetchReply({kind:'ok',memories:[{id:'mine',urn:'hrn:mem:acme.com:mine',name:'My notes',visibility:null}]});
  const m=mountComponent(AppMemories as never,await listProps(rows,{hasAgent:false}));
  try{await tick();
  await press(m.target,'Add memory');
  const existing=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Choose an existing memory')!;
  expect(existing.getAttribute('aria-disabled')).toBeNull();
  const create=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Create a new memory')!;
  expect(create.getAttribute('aria-disabled')).toBe('true');
  expect(document.body.querySelector('[data-testid=app-memory-needs-agent]')).not.toBeNull();
  await press(document.body,'Choose an existing memory');
  await vi.waitFor(()=>expect(document.body.textContent).toContain('My notes'));
  expect(get).toHaveBeenCalled();
  }finally{m.unmount();get.mockRestore();}
 });
 it('leaves out of the picker a memory this App already holds',async()=>{
  const get=fetchReply({kind:'ok',memories:[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',visibility:null},{id:'mine',urn:'hrn:mem:acme.com:mine',name:'My notes',visibility:null}]});
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  await press(m.target,'Add memory');
  await press(document.body,'Choose an existing memory');
  await vi.waitFor(()=>expect(document.body.textContent).toContain('My notes'));
  const picker=document.body.querySelector('[aria-label="Choose a memory"]')!;
  expect(picker.textContent).not.toContain('First');
  }finally{m.unmount();get.mockRestore();}
 });
 it('says what a link does in the choice\'s help text, and promises no key read and no rename',async()=>{
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  await press(m.target,'Add memory');
  const help=document.body.querySelector('#app-memory-existing-help')!.textContent!;
  expect(help).not.toMatch(/personal or private|one of your own/i);
  expect(help).toContain('keeps its name and address');
  expect(help).toMatch(/not copied/);
  expect(help).toMatch(/cannot write/);
  // Victor's rule (hadron-server#5185): a shared personal memory linked into an organization's App is inert for the key.
  expect(help).not.toMatch(/key can read|runs can read|can read it/i);
  expect(help).not.toMatch(/renam/i);
  }finally{m.unmount();}
 });
 it('still offers Add memory when the list is empty',async()=>{
  const m=mountComponent(AppMemories as never,await listProps([]));
  try{await tick();
  expect(m.target.textContent).toContain('No App memories to show.');
  expect([...m.target.querySelectorAll('button')].some(b=>b.textContent?.trim()==='Add memory')).toBe(true);
  }finally{m.unmount();}
 });
 it('still offers Add memory when the list itself could not load: adding does not depend on that read',async()=>{
  const m=mountComponent(AppMemories as never,await listProps(null));
  try{await tick();
  expect(m.target.querySelector('[role=alert]')!.textContent).toContain('Could not load');
  expect([...m.target.querySelectorAll('button')].some(b=>b.textContent?.trim()==='Add memory')).toBe(true);
  }finally{m.unmount();}
 });
});

// portal#2674: detach a linked memory; an attachment that does not count right now is shown as what it is.
describe('detaching a linked memory',()=>{
 const row=(id:string,link?:{active:boolean})=>({id,urn:`hrn:mem:acme.com:${id}`,name:id.toUpperCase(),class:'knowledge',appId:link?null:'a',...(link?{link}:{})});
 const rows=[row('own'),row('on',{active:true}),row('off',{active:false})];
 const button=(root:ParentNode,label:string)=>[...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===label) as HTMLButtonElement|undefined;
 it('offers Detach on each linked memory and on no other row',async()=>{
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  const labels=[...m.target.querySelectorAll('[data-testid=app-memory-detach]')].map(b=>b.getAttribute('aria-label'));
  expect(labels).toEqual(['Detach ON','Detach OFF']);
  }finally{m.unmount();}
 });
 it('marks an inactive link, with helper text under its address, and marks no other row',async()=>{
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  const marks=m.target.querySelectorAll('[data-testid=app-memory-inactive]');
  expect(marks).toHaveLength(1);
  expect(marks[0].closest('tr')!.textContent).toContain('OFF');
  expect(m.target.querySelectorAll('[data-testid=app-memory-inactive-help]')).toHaveLength(1);
  expect(m.target.querySelector('[data-testid=app-memory-inactive-help]')!.textContent).toContain('counts again by itself');
  }finally{m.unmount();}
 });
 it('an inactive link can be detached, like an active one',async()=>{
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  const off=m.target.querySelector<HTMLButtonElement>('[data-testid=app-memory-inactive]')!.closest('tr')!.querySelector<HTMLButtonElement>('[data-testid=app-memory-detach]');
  expect(off).not.toBeNull();
  }finally{m.unmount();}
 });
 it('asks first: the dialog names the memory with its address and says only the link goes; nothing posts until confirmed',async()=>{
  const posted:Record<string,string>[]=[];
  const submit=vi.spyOn(HTMLFormElement.prototype,'requestSubmit').mockImplementation(function(this:HTMLFormElement){posted.push(Object.fromEntries(new FormData(this) as never));});
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  m.target.querySelector<HTMLButtonElement>('[data-testid=app-memory-detach][aria-label="Detach ON"]')!.click();await tick(3);
  const dialog=document.body.querySelector('[data-testid=app-memory-detach-dialog]')!;
  expect(dialog.textContent).toContain('ON');
  expect(dialog.querySelector('[title="hrn:mem:acme.com:on"]')).not.toBeNull();
  expect(dialog.textContent).toContain('removes the link only');
  expect(posted).toEqual([]);
  button(dialog,'Cancel')!.click();await tick(3);
  expect(document.body.querySelector('[data-testid=app-memory-detach-dialog]')).toBeNull();
  expect(posted).toEqual([]);
  }finally{m.unmount();submit.mockRestore();}
 });
 it('posts the confirmed memory to the detach action, once',async()=>{
  const posted:Record<string,string>[]=[];
  const submit=vi.spyOn(HTMLFormElement.prototype,'requestSubmit').mockImplementation(function(this:HTMLFormElement){posted.push(Object.fromEntries(new FormData(this) as never));});
  const m=mountComponent(AppMemories as never,await listProps(rows));
  try{await tick();
  m.target.querySelector<HTMLButtonElement>('[data-testid=app-memory-detach][aria-label="Detach OFF"]')!.click();await tick(3);
  button(document.body.querySelector('[data-testid=app-memory-detach-dialog]')!,'Detach')!.click();
  await vi.waitFor(()=>expect(submit).toHaveBeenCalled());
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({memoryId:'off',_kind:'detachAppMemory'});
  expect(m.target.querySelector('form[action="?/detachMemory"]')).not.toBeNull();
  expect(document.body.querySelector('[data-testid=app-memory-detach-dialog]')).toBeNull();
  }finally{m.unmount();submit.mockRestore();}
 });
 it('shows the server result beside the list: a refusal as an alert, a success without claiming the memory changed',async()=>{
  const detachForm=await superValidate({},zod4(detachAppMemorySchema),{id:'detachAppMemory:a',errors:false});
  const posted=(message:unknown)=>({form:{...detachForm,valid:true,posted:true,data:{_kind:'detachAppMemory',memoryId:'on'},message}});
  const refused=mountComponent(AppMemories as never,await listProps(rows,{result:posted({type:'error',text:'Only whoever made the link can remove it.'})}));
  try{await tick();expect(refused.target.querySelector('[role=alert]')!.textContent).toContain('Only whoever made the link');}finally{refused.unmount();}
  const done=mountComponent(AppMemories as never,await listProps(rows,{result:posted({type:'success',text:'Link removed. The memory itself is unchanged.'})}));
  try{await tick();expect(done.target.querySelector('[role=status]')!.textContent).toContain('Link removed');}finally{done.unmount();}
 });
});
