import { expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import Panel from './UsagePanel.svelte';
import { accountKey } from '$lib/usage-projection/identity';
const a = {account:'Source',host:'one',family:'codex',newestSnapshotAt:'2026-11-11T01:00:00Z',workers:['Mia','Ruth'],workersConfigured:true};
const b = {...a,account:'Other'}, c={...a,account:'Chosen target'};
const projection={account:a.account,host:a.host,family:a.family,asOf:a.newestSnapshotAt,newestSnapshotAt:a.newestSnapshotAt,workers:a.workers,workersConfigured:true,windows:[],whatIf:null};
function view(question:unknown, move=false){return {kind:'ok',accounts:[a,b,c],complete:true,asOf:a.newestSnapshotAt,selected:a,invalid:false,target:move?c:null,question,projection:{kind:'ok',value:projection},whatIf:{kind:'ok',value:{...projection,whatIf:{adjusted:[],target:move?{account:c.account,baseline:[],adjusted:[]}:null}}}};}
it('add answer identifies the question and retains the submitted count',()=>{
 const m=mountComponent(Panel as never,{view:view({kind:'add',count:3}),path:'/usage'} as never);
 try{expect(m.target.querySelector<HTMLInputElement>('#usage-add')!.value).toBe('3');expect(m.target.textContent).toContain('After adding 3 workers');}finally{m.unmount();}
});
it('move answer identifies worker and target and preselects both non-first choices',()=>{
 const m=mountComponent(Panel as never,{view:view({kind:'move',worker:'Ruth',targetKey:accountKey(c)},true),path:'/usage'} as never);
 try{
  expect(m.target.querySelector<HTMLSelectElement>('#usage-worker')!.value).toBe('Ruth');
  expect(m.target.querySelector<HTMLSelectElement>('#usage-target')!.value).toBe(accountKey(c));
  expect(m.target.textContent).toContain('After moving Ruth to Chosen target');
  expect(m.target.textContent).toContain('Target before · Chosen target');expect(m.target.textContent).toContain('Target after · Chosen target');
 }finally{m.unmount();}
});
