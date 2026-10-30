import {it,expect} from 'vitest';
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
 const memories=[{id:'m1',urn:'hrn:mem:acme.com:m1',name:'First',description:null,appId:'a'}];
 const m=mountComponent(AppMemories as never,{initial,result:null,memories,canCreate:false,showDescription} as never);
 try{await tick();
 const headers=[...m.target.querySelectorAll('th')].map(h=>h.textContent?.trim());
 expect(headers.some(h=>h?.startsWith('Description'))).toBe(present);
 expect(headers.some(h=>h?.startsWith('Name'))).toBe(true);
 expect(m.target.textContent).toContain('First');
 }finally{m.unmount();}
});
